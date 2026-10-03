import { api } from '@/core/api/client';
import type { ConversationInfo, Cursor, InboxItem, Message, Page } from '@/core/types';

export const getInbox = (signal?: AbortSignal) => api<InboxItem[]>('/conversations', { signal });

/** Abre o crea la conversación 1:1 con otro usuario. */
export const openConversation = (userId: string) =>
  api<{ id: string }>('/conversations', { method: 'POST', body: { user_id: userId } });

export const getConversation = (id: string, signal?: AbortSignal) =>
  api<ConversationInfo>(`/conversations/${id}`, { signal });

export const getMessages = (conversationId: string, cursor: Cursor, signal?: AbortSignal) =>
  api<Page<Message>>(`/conversations/${conversationId}/messages`, {
    query: { cursor_created_at: cursor?.created_at, cursor_id: cursor?.id, limit: 30 },
    signal,
  });

/** El id lo genera el teléfono: reintentos idempotentes. */
export const sendMessage = (conversationId: string, input: { id: string; body: string }) =>
  api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: input });

export const markRead = (conversationId: string) =>
  api<{ updated: number }>(`/conversations/${conversationId}/read`, { method: 'POST' });

export const markDelivered = () => api<{ updated: number }>('/messages/delivered', { method: 'POST' });
