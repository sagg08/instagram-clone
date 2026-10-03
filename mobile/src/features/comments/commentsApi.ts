import { api } from '@/core/api/client';
import type { Comment } from '@/core/types';

export const getComments = (postId: string, signal?: AbortSignal) =>
  api<Comment[]>(`/posts/${postId}/comments`, { signal });

/** El id lo genera el teléfono: si se reintenta, el servidor reconoce el duplicado (idempotencia). */
export const createComment = (postId: string, input: { id: string; body: string; parent_id: string | null }) =>
  api<Comment>(`/posts/${postId}/comments`, { method: 'POST', body: input });

export const deleteComment = (id: string) => api<void>(`/comments/${id}`, { method: 'DELETE' });
