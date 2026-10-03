import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { ApiError } from '../api/client';
import { outbox, type OutboxAction, type OutboxRow } from './outbox';

/**
 * MOTOR DE SINCRONIZACIÓN: vacía la outbox hacia el servidor.
 *
 * Reglas:
 *  1. FIFO estricto: siempre se envía la CABEZA de la cola. Si falla por red, la
 *     cola se DETIENE ahí (head-of-line blocking) en vez de saltar a la siguiente:
 *     así nunca se envía una acción antes que otra hecha previamente.
 *  2. Un solo vaciado a la vez (flag "running"): dos vaciados en paralelo podrían
 *     enviar la misma acción dos veces o desordenar la cola.
 *  3. Errores de red/servidor (5xx, 429, sin conexión) -> reintento con BACKOFF
 *     EXPONENCIAL + jitter: 1 s, 2 s, 4 s ... hasta 60 s. El jitter evita que miles
 *     de teléfonos reintenten en el mismo milisegundo cuando el servidor vuelve.
 *  4. Errores del cliente (4xx: el post fue borrado, ya no tienes permiso) ->
 *     reintentar daría el mismo error: se DESCARTA y la UI hace rollback.
 *  5. Disparadores: al encolar, al recuperar la red (NetInfo), al volver la app a
 *     primer plano, y cuando vence un backoff.
 *
 * Hilos: todo esto es asíncrono (promesas). Las peticiones HTTP y SQLite corren en
 * hilos nativos; el hilo de JS solo coordina, así que la UI nunca se bloquea.
 */

export type SyncHandler<A extends OutboxAction> = {
  /** Envía la acción al servidor. Debe ser idempotente (puede repetirse tras un fallo). */
  execute: (action: A) => Promise<unknown>;
  /** Tras éxito: confirmar el estado real del servidor en la caché. */
  onSuccess?: (action: A, result: unknown, ctx: { hasNewerPending: boolean }) => void | Promise<void>;
  /** Error permanente: deshacer el cambio optimista. */
  onPermanentFailure?: (action: A, error: ApiError) => void | Promise<void>;
};

type HandlerMap = { [T in OutboxAction['type']]?: SyncHandler<Extract<OutboxAction, { type: T }>> };

const MAX_BACKOFF_MS = 60_000;

const backoffDelay = (attempts: number) => {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4)); // jitter ±20 %
};

/** 401 es reintentable: el token expiró y supabase-js lo refresca en el siguiente intento. */
const isRetryable = (e: unknown) => !(e instanceof ApiError) || e.isRetryable || e.status === 401;

class SyncEngine {
  private handlers: HandlerMap = {};
  private userId: string | null = null;
  private online = true;
  private running = false;
  private dirty = false; // alguien pidió vaciar mientras ya estábamos vaciando
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listenersStarted = false;

  register<T extends OutboxAction['type']>(type: T, handler: SyncHandler<Extract<OutboxAction, { type: T }>>) {
    (this.handlers as Record<string, unknown>)[type] = handler;
  }

  get isOnline() {
    return this.online;
  }

  start(userId: string) {
    this.userId = userId;
    this.startListeners();
    this.kick();
  }

  stop() {
    this.userId = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Solicita un vaciado. Si ya hay uno en curso, se marca para repetir al terminar. */
  kick() {
    if (this.running) {
      this.dirty = true;
      return;
    }
    void this.drain();
  }

  private startListeners() {
    if (this.listenersStarted) return;
    this.listenersStarted = true;

    NetInfo.addEventListener((state) => {
      const wasOnline = this.online;
      // isInternetReachable puede ser null mientras se comprueba: solo "false" significa sin internet.
      this.online = Boolean(state.isConnected) && state.isInternetReachable !== false;
      if (!wasOnline && this.online && this.userId) {
        // Volvió la red: no esperamos el backoff pendiente, se reintenta de inmediato.
        void outbox.resetBackoff(this.userId).then(() => this.kick());
      }
    });

    AppState.addEventListener('change', (s) => s === 'active' && this.kick());
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, ms);
  }

  private async drain() {
    this.running = true;
    try {
      do {
        this.dirty = false;
        await this.drainOnce();
      } while (this.dirty);
    } catch (e) {
      // Falla inesperada (ej. leer SQLite): no dejamos una promesa rechazada sin manejar;
      // la cola sigue intacta en disco y se reintenta en 2 s.
      if (__DEV__) console.warn('[sync] error al vaciar la cola', (e as Error).message);
      this.schedule(2000);
    } finally {
      this.running = false;
    }
  }

  private async drainOnce() {
    while (this.userId && this.online) {
      const userId = this.userId;
      const row = await outbox.head(userId);
      if (!row) return; // cola vacía

      const wait = row.next_attempt_at - Date.now();
      if (wait > 0) {
        this.schedule(wait); // la cabeza está en backoff: esperamos (no saltamos a la siguiente)
        return;
      }

      const action = JSON.parse(row.payload) as OutboxAction;
      const handler = this.handlers[action.type] as SyncHandler<OutboxAction> | undefined;
      if (!handler) {
        await outbox.remove(row.seq); // tipo desconocido (versión vieja de la app): se descarta
        continue;
      }

      outbox.inFlightSeq = row.seq;
      try {
        const result = await handler.execute(action);
        await outbox.remove(row.seq);
        const hasNewerPending = await outbox.hasPending(userId, row.entity_key);
        await handler.onSuccess?.(action, result, { hasNewerPending });
      } catch (e) {
        if (!isRetryable(e)) {
          await outbox.remove(row.seq);
          if (__DEV__) console.warn('[sync] acción descartada', action.type, (e as Error).message);
          await handler.onPermanentFailure?.(action, e as ApiError);
          continue;
        }
        await this.retryLater(row, e);
        return; // FIFO: no se procesa la siguiente hasta que esta salga
      } finally {
        outbox.inFlightSeq = null;
      }
    }
  }

  private async retryLater(row: OutboxRow, error: unknown) {
    const attempts = row.attempts + 1;
    const delay = backoffDelay(attempts);
    await outbox.reschedule(row.seq, attempts, Date.now() + delay, (error as Error).message ?? 'error');
    if (__DEV__) console.warn(`[sync] reintento #${attempts} en ${delay} ms`, (error as Error).message);
    this.schedule(delay);
  }
}

export const syncEngine = new SyncEngine();
