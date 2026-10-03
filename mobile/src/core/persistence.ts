import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import { getDb, withWriteLock } from './db/localDb';

/**
 * Persistencia de la caché de React Query en SQLite (tabla kv).
 * Permite ABRIR LA APP SIN INTERNET y ver el último feed, perfiles y comentarios.
 * Las imágenes salen de la caché en disco del módulo 2 (la clave es el path,
 * así que no importa que las signed URLs guardadas ya hayan expirado).
 *
 * Seguridad: estos datos viven en el sandbox privado de la app (otras apps no
 * pueden leerlos) y se borran al cerrar sesión.
 */
const sqliteStorage = {
  async getItem(key: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row?.value ?? null;
  },
  async setItem(key: string, value: string) {
    await withWriteLock((db) =>
      db.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      ),
    );
  },
  async removeItem(key: string) {
    await withWriteLock((db) => db.runAsync('DELETE FROM kv WHERE key = ?', key));
  },
};

export const persister = createAsyncStoragePersister({
  storage: sqliteStorage,
  key: 'react-query-cache',
  throttleTime: 2000, // como mucho una escritura cada 2 s (no en cada cambio)
});

/** Solo se persisten las consultas que sirven para usar la app offline (no búsquedas, etc.). */
const PERSISTED_ROOTS = new Set(['me', 'feed', 'post', 'comments', 'profile', 'userPosts', 'inbox', 'conversation', 'messages']);

export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000, // datos de más de 24 h no se restauran
  buster: 'v1', // cambiarlo invalida la caché guardada si cambia la forma de los datos
  dehydrateOptions: {
    shouldDehydrateQuery: (q: Query) =>
      q.state.status === 'success' && PERSISTED_ROOTS.has(String(q.queryKey[0])),
  },
};
