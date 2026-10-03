import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { qk, queryClient } from '@/core/queryClient';
import { session } from '@/core/session';
import { supabase } from '@/core/supabase';
import { outbox } from '@/core/sync/outbox';
import { syncEngine } from '@/core/sync/syncEngine';
import type { Comment, Me } from '@/core/types';
import * as commentsApi from './commentsApi';
import { bumpCommentCount, markCommentFailed, pendingToComment, upsertComment } from './commentsCache';

/**
 * Comentarios del post = los del servidor + los míos que siguen en la cola offline
 * (rebase, igual que con los likes). Ordenados por fecha.
 */
export function useComments(postId: string) {
  return useQuery({
    queryKey: qk.comments(postId),
    queryFn: async ({ signal }) => {
      const server = await commentsApi.getComments(postId, signal);
      const userId = session.userId;
      if (!userId) return server;
      const pending = await outbox.pendingComments(userId, postId);
      const known = new Set(server.map((c) => c.id));
      const local = pending.filter((p) => !known.has(p.commentId)).map(pendingToComment);
      return [...server, ...local].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
  });
}

/**
 * Comentarios EN TIEMPO REAL vía Supabase Realtime (WebSocket).
 * Postgres publica cada INSERT en "comments"; Realtime aplica el RLS, así que solo
 * recibimos comentarios de posts que tenemos permiso de ver.
 * El evento no trae los datos del autor, así que solo invalidamos y React Query
 * recarga la lista. Si el comentario es uno nuestro que ya mostramos, no hace nada.
 */
export function useRealtimeComments(postId: string) {
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        (payload) => {
          const id = (payload.new as { id?: string }).id;
          const list = queryClient.getQueryData<Comment[]>(qk.comments(postId));
          const alreadyHave = list?.some((c) => c.id === id && !c._status);
          if (!alreadyHave) void queryClient.invalidateQueries({ queryKey: qk.comments(postId) });
        },
      )
      .subscribe();

    // Al salir de la pantalla cerramos la suscripción: un canal abierto por cada
    // post visitado sería una fuga de conexiones y memoria.
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [postId]);
}

/** Publicar comentario OFFLINE-FIRST: aparece al instante como "pendiente" y se envía por la outbox. */
export function useAddComment(postId: string) {
  return useCallback(
    (body: string, parentId: string | null) => {
      const userId = session.userId;
      const me = queryClient.getQueryData<Me>(qk.me);
      const text = body.trim();
      if (!userId || !text) return;

      const action = {
        type: 'comment' as const,
        commentId: randomUUID(), // el id nace en el teléfono -> reintentos idempotentes
        postId,
        parentId,
        body: text,
        createdAt: new Date().toISOString(),
        author: { id: userId, username: me?.username ?? 'tú', avatar_url: me?.avatar_url ?? null },
      };

      void queryClient.cancelQueries({ queryKey: qk.comments(postId) });
      upsertComment(postId, pendingToComment(action));
      bumpCommentCount(postId, +1);
      outbox
        .enqueue(userId, action)
        .then(() => syncEngine.kick())
        .catch((e) => {
          // Nunca desaparecer en silencio: se marca "No se pudo enviar".
          if (__DEV__) console.warn('[outbox] no se pudo encolar el comentario', e);
          markCommentFailed(postId, action.commentId);
          bumpCommentCount(postId, -1);
        });
    },
    [postId],
  );
}
