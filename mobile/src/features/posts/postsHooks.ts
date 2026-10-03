import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { qk, queryClient } from '@/core/queryClient';
import { session } from '@/core/session';
import { outbox } from '@/core/sync/outbox';
import { syncEngine } from '@/core/sync/syncEngine';
import type { Cursor } from '@/core/types';
import * as postsApi from './postsApi';
import { patchPostInCaches, rebasePendingLikes, withLike } from './postsCache';

// Capa de estado: conecta la capa de datos (postsApi) con la caché de React Query.

export function useFeed() {
  return useInfiniteQuery({
    queryKey: qk.feed,
    queryFn: async ({ pageParam, signal }) => {
      const page = await postsApi.getFeed(pageParam, signal);
      return { ...page, items: await rebasePendingLikes(page.items) };
    },
    initialPageParam: null as Cursor,
    getNextPageParam: (last) => last.next_cursor, // null = no hay más páginas
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: qk.post(id),
    queryFn: async ({ signal }) => {
      const post = await postsApi.getPost(id, signal);
      const [rebased] = await rebasePendingLikes([post]);
      return rebased!;
    },
  });
}

export function useUserPosts(userId: string | undefined, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.userPosts(userId ?? ''),
    queryFn: ({ pageParam, signal }) => postsApi.getUserPosts(userId!, pageParam, signal),
    initialPageParam: null as Cursor,
    getNextPageParam: (last) => last.next_cursor,
    enabled: Boolean(userId) && enabled,
  });
}

/**
 * LIKE OFFLINE-FIRST (módulo 3):
 *  1. La caché en memoria cambia en el MISMO tick del toque -> 0 ms percibidos.
 *  2. La acción se guarda en la outbox de SQLite (persistente).
 *  3. El motor de sincronización la envía cuando haya red.
 * La pantalla nunca espera a la red: por eso funciona igual con o sin conexión.
 * Si el servidor rechaza la acción (ej. el post fue borrado), el handler de sync
 * hace el rollback (ver postsSync.ts).
 */
export function useSetLike() {
  return useCallback((postId: string, liked: boolean) => {
    const userId = session.userId;
    if (!userId) return;
    // Cancela lecturas en curso del feed/post: su respuesta (vieja) pisaría el cambio optimista.
    void queryClient.cancelQueries({ queryKey: qk.feed });
    void queryClient.cancelQueries({ queryKey: qk.post(postId) });
    patchPostInCaches(postId, withLike(liked));
    outbox
      .enqueue(userId, { type: 'like', postId, liked })
      .then(() => syncEngine.kick())
      .catch((e) => {
        // No se pudo guardar en la cola: revertimos el cambio optimista (la UI no debe mentir).
        if (__DEV__) console.warn('[outbox] no se pudo encolar el like', e);
        patchPostInCaches(postId, withLike(!liked));
      });
  }, []);
}

export function useCreatePost() {
  return useMutation({
    mutationFn: ({ uri, caption }: { uri: string; caption: string }) => postsApi.createPost(uri, caption),
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: qk.feed });
      queryClient.invalidateQueries({ queryKey: qk.userPosts(post.author.id) });
      queryClient.invalidateQueries({ queryKey: ['profile'] }); // contador de posts
    },
  });
}
