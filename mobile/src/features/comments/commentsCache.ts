import { qk, queryClient } from '@/core/queryClient';
import type { CommentAction } from '@/core/sync/outbox';
import type { Comment } from '@/core/types';
import { patchPostInCaches } from '@/features/posts/postsCache';

/** Convierte una acción pendiente de la outbox en un comentario dibujable (estado "pendiente"). */
export const pendingToComment = (a: CommentAction): Comment => ({
  id: a.commentId,
  post_id: a.postId,
  parent_id: a.parentId,
  body: a.body,
  created_at: a.createdAt,
  user: a.author,
  _status: 'pending',
});

/** Inserta o reemplaza (por id) un comentario en la caché del post. */
export function upsertComment(postId: string, comment: Comment) {
  queryClient.setQueryData<Comment[]>(qk.comments(postId), (list = []) => {
    const i = list.findIndex((c) => c.id === comment.id);
    if (i === -1) return [...list, comment];
    const copy = list.slice();
    copy[i] = comment;
    return copy;
  });
}

export function markCommentFailed(postId: string, commentId: string) {
  queryClient.setQueryData<Comment[]>(qk.comments(postId), (list) =>
    list?.map((c) => (c.id === commentId ? { ...c, _status: 'failed' as const } : c)),
  );
}

export const bumpCommentCount = (postId: string, delta: number) =>
  patchPostInCaches(postId, (p) => ({ ...p, comment_count: Math.max(0, p.comment_count + delta) }));
