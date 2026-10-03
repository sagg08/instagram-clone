import * as SQLite from 'expo-sqlite';

/**
 * Base de datos embebida (SQLite) de la app. Una sola conexión compartida.
 *  - image_cache: índice LRU de la caché de imágenes en disco (módulo 2)
 *  - (día 2, módulo 3) outbox: cola de sincronización offline
 *
 * expo-sqlite ejecuta las consultas en un hilo NATIVO: las operaciones *Async
 * no bloquean el hilo de JavaScript ni el de UI.
 */

/** Migraciones versionadas: cada índice es una versión. Nunca se edita una ya publicada, solo se agregan. */
const MIGRATIONS: string[] = [
  // v1
  `CREATE TABLE IF NOT EXISTS image_cache (
     key         TEXT PRIMARY KEY NOT NULL,   -- path de la imagen en Storage
     file_name   TEXT NOT NULL,
     bytes       INTEGER NOT NULL,
     last_access INTEGER NOT NULL             -- epoch ms: base del orden LRU
   );
   CREATE INDEX IF NOT EXISTS image_cache_lru ON image_cache (last_access);`,
  // v2 — módulo 3
  `CREATE TABLE IF NOT EXISTS outbox (
     seq             INTEGER PRIMARY KEY AUTOINCREMENT, -- orden cronológico ESTRICTO de llegada
     id              TEXT NOT NULL UNIQUE,              -- id único de la acción
     user_id         TEXT NOT NULL,                     -- dueño: nunca se envía con el token de otro usuario
     type            TEXT NOT NULL,                     -- 'like' | 'comment'
     entity_key      TEXT NOT NULL,                     -- ej. 'like:<postId>': permite compactar
     payload         TEXT NOT NULL,                     -- JSON de la acción
     attempts        INTEGER NOT NULL DEFAULT 0,
     next_attempt_at INTEGER NOT NULL DEFAULT 0,        -- epoch ms (backoff exponencial)
     last_error      TEXT,
     created_at      INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS outbox_user_seq ON outbox (user_id, seq);
   CREATE TABLE IF NOT EXISTS kv (
     key   TEXT PRIMARY KEY NOT NULL,                   -- almacenamiento clave-valor (caché persistida)
     value TEXT NOT NULL
   );`,
  // v3 — módulo 5: estado "visto" de las historias, persistido en el teléfono
  `CREATE TABLE IF NOT EXISTS story_views (
     story_id TEXT PRIMARY KEY NOT NULL,
     seen_at  INTEGER NOT NULL                          -- epoch ms (para limpiar las viejas)
   );`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('instaclone.db');
  // WAL: los LECTORES no bloquean al escritor ni viceversa (pero sigue habiendo UN solo escritor).
  await db.execAsync('PRAGMA journal_mode = WAL;');
  // Si aun así hay contención, esperar hasta 5 s en vez de fallar al instante con
  // "database is locked" (por defecto SQLite espera 0 ms).
  await db.execAsync('PRAGMA busy_timeout = 5000;');

  // PRAGMA user_version guarda qué migraciones ya se aplicaron en este dispositivo.
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // withTransactionAsync usa ESTA conexión. (withExclusiveTransactionAsync abre una
    // segunda conexión: dos escritores -> "database is locked". Por eso no se usa.)
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]!);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

/**
 * MUTEX DE ESCRITURA: toda escritura de la app pasa por aquí y se ejecuta una
 * detrás de otra (cola de promesas). SQLite admite UN solo escritor a la vez; sin
 * esto, la outbox, la caché persistida y el índice de imágenes escribían en paralelo
 * y chocaban (SQLITE_BUSY). Las LECTURAS no necesitan el mutex.
 *
 * Es un mutex del hilo de JS (no bloquea hilos): una escritura "espera" encadenándose
 * a la promesa anterior; mientras tanto la UI sigue respondiendo con normalidad.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export function withWriteLock<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => task(await getDb()));
  writeChain = run.catch(() => {}); // si una escritura falla, la cola NO se queda trabada
  return run;
}

/** Abre la base una sola vez (lazy) y reutiliza la conexión. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open().catch((e) => {
    dbPromise = null; // permite reintentar si falló la apertura
    throw e;
  });
  return dbPromise;
}
