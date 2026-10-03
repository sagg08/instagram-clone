import type { InfiniteData } from '@tanstack/react-query';
import { qk, queryClient } from '@/core/queryClient';
import { session } from '@/core/session';
import { outbox } from '@/core/sync/outbox';
import type { Page, Post } from '@/core/types';

/**
 * Aplica un cambio a un post en TODAS las cachés donde aparece (feed y detalle),
 * para que la UI quede consistente sin importar en qué pantalla estés.
 */
export function patchPostInCaches(postId: string, patch: (p: Post) => Post) {
  queryClient.setQueryData<InfiniteData<Page<Post>>>(qk.feed, (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((p) => (p.id === postId ? patch(p) : p)),
      })),
    },
  );
  queryClient.setQueryData<Post>(qk.post(postId), (p) => (p ? patch(p) : p));
}

/** Fija el estado de like de forma local, ajustando el contador solo si cambió. */
export const withLike = (liked: boolean) => (p: Post): Post =>
  p.liked_by_me === liked ? p : { ...p, liked_by_me: liked, like_count: Math.max(0, p.like_count + (liked ? 1 : -1)) };

/**
 * "REBASE" de acciones pendientes sobre datos frescos del servidor.
 *
 * Problema: das like sin red; luego la app refresca el feed (al volver a primer
 * plano). El servidor aún no sabe de tu like y responde liked=false: tu like
 * "desaparecería" de la pantalla aunque sigue en la cola.
 * Solución: cada respuesta del servidor se corrige con lo que está pendiente en la
 * outbox antes de mostrarse. Es lo mismo que hace git rebase: tus cambios locales
 * se re-aplican encima de la versión nueva del servidor.
 */
export async function rebasePendingLikes<T extends Post>(posts: T[]): Promise<T[]> {
  const userId = session.userId;
  if (!userId || posts.length === 0) return posts;
  const pending = await outbox.pendingLikes(userId);
  if (pending.size === 0) return posts;
  return posts.map((p) => (pending.has(p.id) ? (withLike(pending.get(p.id)!)(p) as T) : p));
}
