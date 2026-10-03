import { randomUUID } from 'expo-crypto';
import { getDb, withWriteLock } from '../db/localDb';

/**
 * OUTBOX — cola de sincronización persistente en SQLite (módulo 3).
 *
 * Patrón "Transactional Outbox": toda acción del usuario se escribe primero en la
 * base LOCAL y desde ahí se envía al servidor. Si no hay red, o la app se cierra,
 * la acción sigue guardada y se envía después. Nada se pierde.
 *
 * Orden cronológico estricto: "seq" es AUTOINCREMENT, así que el orden de envío
 * es exactamente el orden en que el usuario hizo las acciones.
 */

export type LikeAction = { type: 'like'; postId: string; liked: boolean };
export type CommentAction = {
  type: 'comment';
  commentId: string; // UUID generado en el teléfono: el servidor lo usa como PK (idempotencia)
  postId: string;
  parentId: string | null;
  body: string;
  author: { id: string; username: string; avatar_url: string | null }; // para pintarlo ya, sin red
  createdAt: string;
};
export type MessageAction = {
  type: 'message';
  messageId: string; // UUID generado en el teléfono (idempotencia, igual que los comentarios)
  conversationId: string;
  body: string;
  senderId: string;
  createdAt: string;
};
export type OutboxAction = LikeAction | CommentAction | MessageAction;

export type OutboxRow = {
  seq: number;
  id: string;
  user_id: string;
  type: OutboxAction['type'];
  entity_key: string;
  payload: string;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
};

const entityKey = (a: OutboxAction) => {
  switch (a.type) {
    case 'like':
      return `like:${a.postId}`;
    case 'comment':
      return `comment:${a.commentId}`;
    case 'message':
      return `message:${a.messageId}`;
  }
};

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

class Outbox {
  /** seq de la acción que se está enviando en este momento: nunca se compacta. */
  inFlightSeq: number | null = null;

  /**
   * Encola una acción. Para los likes aplica COMPACTACIÓN: si el usuario, sin red,
   * da like -> unlike -> like al mismo post, solo importa el estado final; se borran
   * las acciones anteriores pendientes de ESE post y queda una sola petición.
   * Las acciones de otras entidades conservan su orden relativo.
   */
  async enqueue(userId: string, action: OutboxAction) {
    const key = entityKey(action);
    // Transacción: compactar + insertar son atómicos (o pasan los dos, o ninguno).
    await withWriteLock((db) => db.withTransactionAsync(async () => {
      if (action.type === 'like') {
        await db.runAsync(
          'DELETE FROM outbox WHERE user_id = ? AND entity_key = ? AND seq <> ?',
          userId,
          key,
          this.inFlightSeq ?? -1,
        );
      }
      await db.runAsync(
        'INSERT INTO outbox (id, user_id, type, entity_key, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        randomUUID(),
        userId,
        action.type,
        key,
        JSON.stringify(action),
        Date.now(),
      );
    }));
    notify();
  }

  /** La acción más antigua pendiente (cabeza de la cola FIFO). */
  async head(userId: string): Promise<OutboxRow | null> {
    const db = await getDb();
    return db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE user_id = ? ORDER BY seq ASC LIMIT 1', userId);
  }

  async remove(seq: number) {
    await withWriteLock((db) => db.runAsync('DELETE FROM outbox WHERE seq = ?', seq));
    notify();
  }

  async reschedule(seq: number, attempts: number, nextAttemptAt: number, error: string) {
    await withWriteLock((db) =>
      db.runAsync(
        'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE seq = ?',
        attempts,
        nextAttemptAt,
        error,
        seq,
      ),
    );
    notify();
  }

  /** Al volver la conexión, no tiene sentido seguir esperando el backoff: se reintenta ya. */
  async resetBackoff(userId: string) {
    await withWriteLock((db) => db.runAsync('UPDATE outbox SET next_attempt_at = 0 WHERE user_id = ?', userId));
  }

  async hasPending(userId: string, key: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM outbox WHERE user_id = ? AND entity_key = ?',
      userId,
      key,
    );
    return (row?.n ?? 0) > 0;
  }

  async count(userId: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE user_id = ?', userId);
    return row?.n ?? 0;
  }

  /** Estado final pendiente de cada like (postId -> liked). Sirve para el "rebase" sobre datos del servidor. */
  async pendingLikes(userId: string): Promise<Map<string, boolean>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM outbox WHERE user_id = ? AND type = 'like' ORDER BY seq ASC",
      userId,
    );
    const result = new Map<string, boolean>();
    for (const r of rows) {
      const a = JSON.parse(r.payload) as LikeAction;
      result.set(a.postId, a.liked); // ASC: la última acción gana
    }
    return result;
  }

  async pendingComments(userId: string, postId: string): Promise<CommentAction[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM outbox WHERE user_id = ? AND type = 'comment' ORDER BY seq ASC",
      userId,
    );
    return rows.map((r) => JSON.parse(r.payload) as CommentAction).filter((c) => c.postId === postId);
  }

  async pendingMessages(userId: string, conversationId: string): Promise<MessageAction[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM outbox WHERE user_id = ? AND type = 'message' ORDER BY seq ASC",
      userId,
    );
    return rows.map((r) => JSON.parse(r.payload) as MessageAction).filter((m) => m.conversationId === conversationId);
  }

  async clearUser(userId: string) {
    await withWriteLock((db) => db.runAsync('DELETE FROM outbox WHERE user_id = ?', userId));
    notify();
  }

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
}

export const outbox = new Outbox();
