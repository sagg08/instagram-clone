import type { SupabaseClient } from '@supabase/supabase-js';
import { assertOk, HttpError, notFound, unwrap, unwrapMaybe } from '../../lib/errors.js';
import { avatarUrl } from '../../lib/storage.js';
import { nextCursor } from '../../lib/schemas.js';

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, created_at, delivered_at, read_at';

type InboxRow = {
  conversation_id: string;
  last_message_at: string;
  other_id: string;
  other_username: string;
  other_full_name: string | null;
  other_avatar_path: string | null;
  last_body: string | null;
  last_sender_id: string | null;
  last_created_at: string | null;
  last_read_at: string | null;
  unread_count: number;
};

/** Bandeja ordenada por el último mensaje (lo calcula get_inbox en una sola consulta). */
export async function getInbox(db: SupabaseClient) {
  const rows = unwrap(await db.rpc('get_inbox')) as InboxRow[];
  return rows.map((r) => ({
    id: r.conversation_id,
    last_message_at: r.last_message_at,
    other: {
      id: r.other_id,
      username: r.other_username,
      full_name: r.other_full_name,
      avatar_url: avatarUrl(db, r.other_avatar_path),
    },
    last_message: r.last_body
      ? { body: r.last_body, sender_id: r.last_sender_id, created_at: r.last_created_at, read_at: r.last_read_at }
      : null,
    unread_count: Number(r.unread_count),
  }));
}

/**
 * Abre (o crea) la conversación 1:1 con otro usuario.
 * La pareja se guarda ordenada (user_a < user_b) y la tabla tiene UNIQUE(user_a, user_b):
 * aunque los dos usuarios abran el chat a la vez, existe UNA sola conversación.
 */
export async function openConversation(db: SupabaseClient, me: string, otherId: string) {
  if (me === otherId) throw new HttpError(400, 'SELF_CHAT', 'No puedes escribirte a ti mismo');
  const [user_a, user_b] = me < otherId ? [me, otherId] : [otherId, me];

  const { error } = await db.from('conversations').insert({ user_a, user_b });
  // 23505 = ya existía (incluida la carrera en que el otro la creó en el mismo instante): no es error.
  if (error && error.code !== '23505') assertOk({ error });

  const conv = unwrap(
    await db.from('conversations').select('id').eq('user_a', user_a).eq('user_b', user_b).single(),
  );
  return { id: conv.id as string };
}

/** Datos del chat: con quién hablo (para el encabezado). El RLS impide abrir conversaciones ajenas. */
export async function getConversation(db: SupabaseClient, me: string, conversationId: string) {
  const conv = unwrapMaybe(
    await db.from('conversations').select('id, user_a, user_b').eq('id', conversationId).maybeSingle(),
  );
  if (!conv) throw notFound('Conversación');
  const otherId = conv.user_a === me ? conv.user_b : conv.user_a;
  const other = unwrap(
    await db.from('profiles').select('id, username, full_name, avatar_path').eq('id', otherId).single(),
  );
  return {
    id: conv.id,
    other: { id: other.id, username: other.username, full_name: other.full_name, avatar_url: avatarUrl(db, other.avatar_path) },
  };
}

/** Mensajes del más nuevo al más viejo, paginados por cursor (la lista del chat está invertida). */
export async function listMessages(
  db: SupabaseClient,
  conversationId: string,
  cursor: { created_at?: string; id?: string },
  limit: number,
) {
  let query = db
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (cursor.created_at && cursor.id) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }
  const rows = unwrap(await query);
  return { items: rows, next_cursor: nextCursor(rows, limit) };
}

/**
 * Enviar mensaje con id generado en el CLIENTE (idempotente, igual que los comentarios):
 * si la cola offline reintenta y el mensaje ya existe, se devuelve el existente.
 */
export async function sendMessage(
  db: SupabaseClient,
  me: string,
  conversationId: string,
  input: { id: string; body: string },
) {
  const { error } = await db
    .from('messages')
    .insert({ id: input.id, conversation_id: conversationId, sender_id: me, body: input.body });

  let created = true;
  if (error?.code === '23505') created = false;
  else if (error?.code === '42501') throw notFound('Conversación'); // RLS: no es participante
  else if (error) assertOk({ error });

  const row = unwrapMaybe(await db.from('messages').select(MESSAGE_COLUMNS).eq('id', input.id).maybeSingle());
  // El UUID ya existía pero en OTRA conversación o de otro remitente: conflicto real.
  if (!row || row.sender_id !== me || row.conversation_id !== conversationId) {
    throw new HttpError(409, 'ID_CONFLICT', 'El id del mensaje ya está en uso');
  }
  return { created, message: row };
}

/**
 * "Entregado": el dispositivo del destinatario recibió los mensajes.
 * Marca TODOS mis mensajes recibidos aún no entregados, en todas mis conversaciones.
 * El RLS ("messages: marcar estado") solo permite actualizar mensajes que me enviaron a mí,
 * y el GRANT por columna solo deja tocar delivered_at / read_at (nunca el texto).
 */
export async function markDelivered(db: SupabaseClient, me: string) {
  const rows = unwrap(
    await db
      .from('messages')
      .update({ delivered_at: new Date().toISOString() })
      .neq('sender_id', me)
      .is('delivered_at', null)
      .select('id'),
  );
  return { updated: rows.length };
}

/** "Visto": abrí el chat. Leído implica entregado. */
export async function markRead(db: SupabaseClient, me: string, conversationId: string) {
  const now = new Date().toISOString();
  // Los que ni siquiera estaban entregados quedan entregados y leídos a la vez.
  assertOk(
    await db
      .from('messages')
      .update({ delivered_at: now })
      .eq('conversation_id', conversationId)
      .neq('sender_id', me)
      .is('delivered_at', null),
  );
  const rows = unwrap(
    await db
      .from('messages')
      .update({ read_at: now })
      .eq('conversation_id', conversationId)
      .neq('sender_id', me)
      .is('read_at', null)
      .select('id'),
  );
  return { updated: rows.length };
}
