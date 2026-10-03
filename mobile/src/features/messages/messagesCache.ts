import type { InfiniteData } from '@tanstack/react-query';
import { qk, queryClient } from '@/core/queryClient';
import type { MessageAction } from '@/core/sync/outbox';
import type { Message, Page } from '@/core/types';

type MessagesData = InfiniteData<Page<Message>>;

/** Mensaje pendiente de la outbox -> mensaje dibujable con estado "Enviando". */
export const pendingToMessage = (a: MessageAction): Message => ({
  id: a.messageId,
  conversation_id: a.conversationId,
  sender_id: a.senderId,
  body: a.body,
  created_at: a.createdAt,
  delivered_at: null,
  read_at: null,
  _status: 'pending',
});

/**
 * Inserta o reemplaza (por id) un mensaje en la caché del chat.
 * La lista va del más NUEVO al más viejo (FlatList invertida), así que uno nuevo
 * va al principio de la primera página. Reemplazar por id es lo que convierte un
 * mensaje "pendiente" en "enviado" cuando llega la confirmación (o el evento Realtime).
 */
export function upsertMessage(message: Message) {
  queryClient.setQueryData<MessagesData>(qk.messages(message.conversation_id), (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => {
        if (m.id !== message.id) return m;
        found = true;
        return message;
      }),
    }));
    if (!found && pages[0]) pages[0] = { ...pages[0], items: [message, ...pages[0].items] };
    return { ...data, pages };
  });
}

/** Actualiza solo los campos de estado (entregado / visto) que llegan por Realtime. */
export function patchMessageStatus(m: Pick<Message, 'id' | 'conversation_id' | 'delivered_at' | 'read_at'>) {
  queryClient.setQueryData<MessagesData>(qk.messages(m.conversation_id), (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((x) => (x.id === m.id ? { ...x, delivered_at: m.delivered_at, read_at: m.read_at } : x)),
      })),
    },
  );
}

export function markMessageFailed(conversationId: string, messageId: string) {
  queryClient.setQueryData<MessagesData>(qk.messages(conversationId), (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((x) => (x.id === messageId ? { ...x, _status: 'failed' as const } : x)),
      })),
    },
  );
}
