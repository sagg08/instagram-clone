import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { qk, queryClient } from '@/core/queryClient';
import { session } from '@/core/session';
import { supabase } from '@/core/supabase';
import { outbox } from '@/core/sync/outbox';
import { syncEngine } from '@/core/sync/syncEngine';
import type { Cursor, Message } from '@/core/types';
import * as messagesApi from './messagesApi';
import { markMessageFailed, patchMessageStatus, pendingToMessage, upsertMessage } from './messagesCache';

/** Bandeja de entrada (ordenada por el servidor según last_message_at). */
export function useInbox() {
  return useQuery({ queryKey: qk.inbox, queryFn: ({ signal }) => messagesApi.getInbox(signal) });
}

/** Total de mensajes sin leer (para el globito del ícono de mensajes). */
export function useUnreadTotal() {
  const { data } = useInbox();
  return data?.reduce((sum, c) => sum + c.unread_count, 0) ?? 0;
}

export function useConversation(id: string) {
  return useQuery({ queryKey: qk.conversation(id), queryFn: ({ signal }) => messagesApi.getConversation(id, signal) });
}

/**
 * Mensajes del chat, paginados hacia atrás (del más nuevo al más viejo).
 * La primera página se combina con mis mensajes que siguen en la cola offline.
 */
export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: qk.messages(conversationId),
    queryFn: async ({ pageParam, signal }) => {
      const page = await messagesApi.getMessages(conversationId, pageParam, signal);
      const userId = session.userId;
      if (pageParam || !userId) return page;
      const pending = await outbox.pendingMessages(userId, conversationId);
      const known = new Set(page.items.map((m) => m.id));
      const local = pending.filter((p) => !known.has(p.messageId)).map(pendingToMessage).reverse();
      return { ...page, items: [...local, ...page.items] };
    },
    initialPageParam: null as Cursor,
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Enviar mensaje OFFLINE-FIRST: aparece al instante como "Enviando" y sale por la outbox. */
export function useSendMessage(conversationId: string) {
  return useCallback(
    (body: string) => {
      const userId = session.userId;
      const text = body.trim();
      if (!userId || !text) return;
      const action = {
        type: 'message' as const,
        messageId: randomUUID(),
        conversationId,
        body: text,
        senderId: userId,
        createdAt: new Date().toISOString(),
      };
      upsertMessage(pendingToMessage(action));
      outbox
        .enqueue(userId, action)
        .then(() => syncEngine.kick())
        .catch((e) => {
          // Nunca desaparecer en silencio: se marca "No se pudo enviar".
          if (__DEV__) console.warn('[outbox] no se pudo encolar el mensaje', e);
          markMessageFailed(conversationId, action.messageId);
        });
    },
    [conversationId],
  );
}

// ---------------------------------------------------------------------------
// Confirmaciones de ENTREGA. Se agrupan (debounce): si llegan 5 mensajes seguidos,
// se hace UNA sola petición en vez de 5.
let deliveredTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleMarkDelivered() {
  if (deliveredTimer) clearTimeout(deliveredTimer);
  deliveredTimer = setTimeout(() => {
    deliveredTimer = null;
    messagesApi.markDelivered().catch(() => {}); // si falla, se reintenta en el próximo evento o al volver a la app
  }, 500);
}

/** Qué chat está abierto ahora (para marcar "Visto" al instante los mensajes que llegan). */
let openConversationId: string | null = null;

/**
 * UNA sola suscripción Realtime global a la tabla messages (montada en el layout de pestañas).
 * No lleva filtro: el RLS de Realtime solo entrega mensajes de MIS conversaciones.
 *  - INSERT de otro usuario -> confirmo entrega, refresco la bandeja, lo agrego al chat.
 *  - INSERT mío             -> reemplaza mi mensaje pendiente (por si la respuesta HTTP se perdió).
 *  - UPDATE                 -> el otro recibió/leyó mi mensaje: actualizo "Entregado"/"Visto".
 * Una sola conexión para toda la app: abrir 10 chats no abre 10 WebSockets.
 */
export function useMessagesRealtime(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    // Mensajes que llegaron con la app cerrada: confirmo la entrega al abrir / volver a la app.
    scheduleMarkDelivered();
    const appSub = AppState.addEventListener('change', (s) => s === 'active' && scheduleMarkDelivered());

    const channel = supabase
      .channel(`messages:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        upsertMessage(m);
        void queryClient.invalidateQueries({ queryKey: qk.inbox });
        if (m.sender_id !== userId) {
          if (m.conversation_id === openConversationId) markReadSoon(m.conversation_id);
          else scheduleMarkDelivered();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        patchMessageStatus(payload.new as Message);
      })
      .subscribe();

    return () => {
      appSub.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}

let readTimer: ReturnType<typeof setTimeout> | null = null;
function markReadSoon(conversationId: string) {
  if (readTimer) clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    readTimer = null;
    messagesApi
      .markRead(conversationId)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.inbox }))
      .catch(() => {});
  }, 300);
}

/** Mientras el chat está abierto: marca "Visto" al entrar y con cada mensaje nuevo que llega. */
export function useMarkReadWhileOpen(conversationId: string) {
  useEffect(() => {
    openConversationId = conversationId;
    markReadSoon(conversationId);
    return () => {
      if (openConversationId === conversationId) openConversationId = null;
    };
  }, [conversationId]);
}

/**
 * "ESCRIBIENDO..." con Realtime BROADCAST en un canal PRIVADO.
 * - Broadcast: el evento va de teléfono a teléfono a través del servidor de Realtime,
 *   SIN escribirse en la base de datos (es efímero: no tiene sentido guardar que alguien escribía).
 * - Privado: las políticas RLS de realtime.messages (migración 0003) solo dejan unirse a los
 *   dos participantes de la conversación.
 * - Throttle: aunque escribas 10 letras por segundo, se envía como mucho 1 evento cada 2 s.
 * - Si no llega un evento nuevo en 4 s, el indicador se apaga solo (por si el otro cerró la app).
 */
export function useTyping(conversationId: string) {
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const readyRef = useRef(false);
  const lastSentRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const me = session.userId;
    const channel = supabase
      .channel(`typing:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.user_id === me) return;
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setOtherTyping(Boolean(payload.typing));
        if (payload.typing) hideTimer.current = setTimeout(() => setOtherTyping(false), 4000);
      })
      .subscribe((status) => {
        readyRef.current = status === 'SUBSCRIBED';
      });
    channelRef.current = channel;

    return () => {
      readyRef.current = false;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const send = useCallback((typing: boolean) => {
    if (!readyRef.current || !channelRef.current) return;
    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: session.userId, typing } });
  }, []);

  /** Llamar en cada cambio del texto. */
  const onTextChange = useCallback(
    (text: string) => {
      if (!text) {
        lastSentRef.current = 0;
        send(false);
        return;
      }
      const now = Date.now();
      if (now - lastSentRef.current > 2000) {
        lastSentRef.current = now;
        send(true);
      }
    },
    [send],
  );

  /** Llamar al enviar el mensaje o salir del chat. */
  const stopTyping = useCallback(() => {
    lastSentRef.current = 0;
    send(false);
  }, [send]);

  // Mensaje recibido -> el otro ya dejó de escribir.
  const clearOtherTyping = useCallback(() => setOtherTyping(false), []);

  return { otherTyping, onTextChange, stopTyping, clearOtherTyping };
}

/** Abre (o crea) la conversación con un usuario. */
export const openConversationWith = (userId: string) => messagesApi.openConversation(userId);
