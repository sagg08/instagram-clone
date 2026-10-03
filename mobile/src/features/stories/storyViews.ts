import { getDb, withWriteLock } from '@/core/db/localDb';

/**
 * Estado "visto" de las historias, PERSISTIDO en SQLite (requisito del módulo 5).
 * Es un dato local del teléfono: no se envía al servidor. Si cierras la app y la
 * vuelves a abrir, las historias que ya viste siguen con el anillo gris.
 */
const KEEP_MS = 48 * 60 * 60 * 1000; // una historia dura 24 h: guardar 48 h basta y sobra

export async function loadSeenStoryIds(): Promise<Set<string>> {
  // Limpieza: las vistas de historias ya caducadas no sirven para nada.
  await withWriteLock((db) => db.runAsync('DELETE FROM story_views WHERE seen_at < ?', Date.now() - KEEP_MS));
  const db = await getDb();
  const rows = await db.getAllAsync<{ story_id: string }>('SELECT story_id FROM story_views');
  return new Set(rows.map((r) => r.story_id));
}

export async function saveStorySeen(storyId: string) {
  // INSERT OR IGNORE: verla dos veces no duplica nada (idempotente).
  await withWriteLock((db) =>
    db.runAsync('INSERT OR IGNORE INTO story_views (story_id, seen_at) VALUES (?, ?)', storyId, Date.now()),
  );
}
