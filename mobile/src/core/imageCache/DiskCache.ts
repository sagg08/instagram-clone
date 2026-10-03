import { Directory, File, Paths } from 'expo-file-system';
import { getDb, withWriteLock } from '../db/localDb';

/**
 * NIVEL 2 — caché en DISCO con desalojo LRU.
 *
 * - Los archivos viven en el directorio de caché del sistema (Paths.cache):
 *   el SO puede vaciarlo si el teléfono se queda sin espacio, y no se respalda en iCloud.
 * - El índice (qué hay, cuánto pesa, cuándo se usó) vive en SQLite: sobrevive a
 *   reinicios de la app y permite ordenar por last_access en O(log n) gracias al índice.
 * - Para no escribir en SQLite en CADA lectura, los "touch" se acumulan en memoria
 *   y se guardan en lote cada pocos segundos (write batching).
 */
const MAX_DISK_BYTES = 150 * 1024 * 1024; // 150 MB
const FLUSH_TOUCHES_MS = 3000;

const dir = new Directory(Paths.cache, 'image-cache');

/** El path de Storage ("uuid/uuid.jpg") se convierte en un nombre de archivo seguro. */
const toFileName = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

type IndexRow = { key: string; file_name: string; bytes: number; last_access: number };

class DiskCacheImpl {
  private ready: Promise<void> | null = null;
  private pendingTouches = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private init() {
    this.ready ??= (async () => {
      dir.create({ intermediates: true, idempotent: true });
      // Reconciliación: si el SO borró archivos, quitamos sus filas huérfanas del índice.
      const db = await getDb();
      const rows = await db.getAllAsync<IndexRow>('SELECT key, file_name FROM image_cache');
      const missing = rows.filter((r) => !new File(dir, r.file_name).exists);
      if (missing.length > 0) {
        await withWriteLock(async (w) => {
          for (const r of missing) await w.runAsync('DELETE FROM image_cache WHERE key = ?', r.key);
        });
      }
    })();
    return this.ready;
  }

  /** URI local del archivo si está en disco; null si no. Marca el acceso (LRU). */
  async get(key: string): Promise<string | null> {
    await this.init();
    const file = new File(dir, toFileName(key));
    if (!file.exists) return null;
    this.touch(key);
    return file.uri;
  }

  /** Destino temporal para una descarga: se escribe en ".part" y luego se mueve (escritura atómica). */
  tempFileFor(key: string): File {
    return new File(dir, `${toFileName(key)}.${Date.now()}.part`);
  }

  /**
   * Registra un archivo ya descargado. El "move" del .part al nombre final es atómico
   * en el sistema de archivos: nunca queda un archivo a medias con el nombre definitivo
   * (por ejemplo, si la descarga se cancela o la app se cierra en pleno proceso).
   */
  async commit(key: string, tempFile: File): Promise<string> {
    await this.init();
    const finalFile = new File(dir, toFileName(key));
    if (finalFile.exists) finalFile.delete();
    await tempFile.move(finalFile);

    const bytes = finalFile.size ?? 0;
    await withWriteLock((db) =>
      db.runAsync(
        `INSERT INTO image_cache (key, file_name, bytes, last_access) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET bytes = excluded.bytes, last_access = excluded.last_access`,
        key,
        finalFile.name,
        bytes,
        Date.now(),
      ),
    );
    // FUERA del lock anterior: el desalojo toma su propio lock (anidar locks = deadlock).
    await this.evictIfNeeded();
    return finalFile.uri;
  }

  /** Borra un archivo corrupto (por ejemplo, la descarga no era una imagen válida). */
  async remove(key: string) {
    const file = new File(dir, toFileName(key));
    if (file.exists) file.delete();
    await withWriteLock((db) => db.runAsync('DELETE FROM image_cache WHERE key = ?', key));
  }

  async stats() {
    await this.init();
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number; total: number | null }>(
      'SELECT COUNT(*) AS n, SUM(bytes) AS total FROM image_cache',
    );
    return { files: row?.n ?? 0, bytes: row?.total ?? 0, maxBytes: MAX_DISK_BYTES };
  }

  async clear() {
    await this.init();
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true, idempotent: true });
    await withWriteLock((db) => db.runAsync('DELETE FROM image_cache'));
  }

  private touch(key: string) {
    this.pendingTouches.set(key, Date.now());
    this.flushTimer ??= setTimeout(() => void this.flushTouches(), FLUSH_TOUCHES_MS);
  }

  private async flushTouches() {
    this.flushTimer = null;
    const touches = [...this.pendingTouches];
    this.pendingTouches.clear();
    if (touches.length === 0) return;
    // Un lote en UNA transacción: N actualizaciones = un solo commit a disco.
    await withWriteLock((db) =>
      db.withTransactionAsync(async () => {
        for (const [key, at] of touches) {
          await db.runAsync('UPDATE image_cache SET last_access = ? WHERE key = ?', at, key);
        }
      }),
    ).catch(() => {}); // perder un "touch" solo afecta el orden LRU: no es crítico
  }

  /** Si el total supera el presupuesto, borra las menos usadas hasta quedar al 90 % (histéresis). */
  private async evictIfNeeded() {
    const db = await getDb();
    const row = await db.getFirstAsync<{ total: number | null }>('SELECT SUM(bytes) AS total FROM image_cache');
    let total = row?.total ?? 0;
    if (total <= MAX_DISK_BYTES) return;

    // Bajamos al 90 % y no justo al límite: así no hay que desalojar en cada nueva descarga.
    const target = MAX_DISK_BYTES * 0.9;
    const oldest = await db.getAllAsync<IndexRow>(
      'SELECT key, file_name, bytes FROM image_cache ORDER BY last_access ASC LIMIT 200',
    );
    const toEvict: IndexRow[] = [];
    for (const r of oldest) {
      if (total <= target) break;
      toEvict.push(r);
      total -= r.bytes;
    }
    for (const r of toEvict) {
      const file = new File(dir, r.file_name);
      if (file.exists) file.delete();
    }
    await withWriteLock(async (w) => {
      for (const r of toEvict) await w.runAsync('DELETE FROM image_cache WHERE key = ?', r.key);
    });
  }
}

export const diskCache = new DiskCacheImpl();
