import { AppState } from 'react-native';
import { Image, type ImageRef } from 'expo-image';
import { LruCache } from './LruCache';
import { diskCache } from './DiskCache';
import { CancelledError, DownloadQueue } from './DownloadQueue';

/**
 * MOTOR DE CACHÉ DE IMÁGENES DE DOS NIVELES (propio, sin carga automática de librerías).
 *
 *   petición ──► L1 RAM (bitmaps YA decodificados, LRU por bytes)   ~0 ms, síncrono
 *                  │ miss
 *                  ▼
 *               L2 DISCO (archivos JPEG, LRU con índice SQLite)     ~10-30 ms
 *                  │ miss
 *                  ▼
 *               RED (cola de 4 descargas, LIFO, cancelable)         ~100-1000 ms
 *
 * Cada nivel "promueve" hacia arriba: lo descargado se guarda en disco y,
 * al decodificarse, en RAM.
 *
 * Sobre los hilos: la descarga, la escritura a disco, la decodificación JPEG y el
 * redimensionado ocurren en hilos NATIVOS de fondo. El hilo de JavaScript solo
 * coordina (promesas, mapas) y el hilo de UI solo dibuja un bitmap ya listo.
 * Por eso el scroll no se traba aunque se estén cargando imágenes.
 */
const MEMORY_BUDGET_BYTES = 64 * 1024 * 1024; // 64 MB de bitmaps decodificados

type InFlight = {
  promise: Promise<ImageRef>;
  subscribers: number;
  aborted: boolean;
  cancelDownload?: () => void;
};

class ImageCacheImpl {
  /** L1: al desalojar se llama release() -> el SO recupera la memoria del bitmap de inmediato. */
  private memory = new LruCache<string, ImageRef>(MEMORY_BUDGET_BYTES, (_key, ref) => ref.release());
  /** Deduplicación: dos celdas pidiendo la misma imagen comparten UNA sola carga. */
  private inFlight = new Map<string, InFlight>();
  private downloads = new DownloadQueue(4);

  readonly stats = { memoryHits: 0, diskHits: 0, networkLoads: 0, cancelled: 0, errors: 0 };

  constructor() {
    // Ante advertencia de memoria del SO, o al pasar a segundo plano (donde iOS mata
    // primero a las apps que más memoria usan), liberamos todo lo que no está visible.
    AppState.addEventListener('memoryWarning', () => this.memory.trimUnpinned());
    AppState.addEventListener('change', (s) => s === 'background' && this.memory.trimUnpinned());
  }

  /**
   * La clave de RAM incluye el tamaño de decodificación: la misma foto en el feed
   * (~1280 px) y en la grilla del perfil (~512 px) son bitmaps distintos.
   */
  memoryKey(storageKey: string, pixelWidth: number) {
    return `${storageKey}@${pixelWidth}`;
  }

  /** Lectura SÍNCRONA de L1: si está, se dibuja en el mismo frame (sin parpadeo). */
  peek(memKey: string): ImageRef | undefined {
    return this.memory.get(memKey);
  }

  pin(memKey: string) {
    return this.memory.pin(memKey);
  }

  unpin(memKey: string) {
    this.memory.unpin(memKey);
  }

  /**
   * Carga asíncrona (L2 -> red). Devuelve una función cancel() propia de cada
   * suscriptor: la descarga solo se aborta cuando TODOS los interesados cancelaron.
   */
  load(storageKey: string, url: string | null, pixelWidth: number) {
    const memKey = this.memoryKey(storageKey, pixelWidth);
    let req = this.inFlight.get(memKey);
    if (!req) {
      req = this.start(storageKey, url, pixelWidth, memKey);
      this.inFlight.set(memKey, req);
    }
    req.subscribers += 1;

    let released = false;
    const current = req;
    const cancel = () => {
      if (released) return;
      released = true;
      current.subscribers -= 1;
      if (current.subscribers === 0) {
        current.aborted = true;
        current.cancelDownload?.();
        if (this.inFlight.get(memKey) === current) this.inFlight.delete(memKey);
        this.stats.cancelled += 1;
      }
    };
    return { promise: current.promise, cancel };
  }

  async getStats() {
    return {
      ...this.stats,
      memory: { entries: this.memory.size, bytes: this.memory.bytes, maxBytes: MEMORY_BUDGET_BYTES },
      disk: await diskCache.stats(),
      queue: this.downloads.pending,
    };
  }

  /** Vacía ambos niveles (útil para demostrar el motor en la defensa). */
  async clearAll() {
    this.memory.trimUnpinned();
    await diskCache.clear();
    Object.assign(this.stats, { memoryHits: 0, diskHits: 0, networkLoads: 0, cancelled: 0, errors: 0 });
  }

  recordMemoryHit() {
    this.stats.memoryHits += 1;
  }

  private start(storageKey: string, url: string | null, pixelWidth: number, memKey: string): InFlight {
    const req: InFlight = { subscribers: 0, aborted: false, promise: Promise.resolve(null as never) };

    req.promise = (async () => {
      // ── L2: disco
      let fileUri = await diskCache.get(storageKey);
      if (fileUri) {
        this.stats.diskHits += 1;
      } else {
        // ── Red
        if (!url) throw new Error('Imagen sin URL');
        if (req.aborted) throw new CancelledError();
        const temp = diskCache.tempFileFor(storageKey);
        const download = this.downloads.enqueue(url, temp);
        req.cancelDownload = download.cancel;
        const file = await download.promise;
        fileUri = await diskCache.commit(storageKey, file);
        this.stats.networkLoads += 1;
      }
      if (req.aborted) throw new CancelledError(); // ya quedó en disco; no gastamos RAM decodificando

      // ── Decodificación (hilo nativo) reducida al ancho real en pantalla:
      // una foto de 1080 px mostrada en una miniatura de 130 pt no ocupa 4,6 MB sino ~0,3 MB.
      let ref: ImageRef;
      try {
        ref = await Image.loadAsync({ uri: fileUri }, { maxWidth: pixelWidth });
      } catch (e) {
        await diskCache.remove(storageKey); // archivo corrupto o no era imagen
        throw e;
      }

      // ── L1: costo real en memoria = ancho px × alto px × 4 bytes (RGBA)
      const bytes = Math.round(ref.width * ref.scale * ref.height * ref.scale * 4);
      this.memory.set(memKey, ref, bytes);
      return ref;
    })();

    req.promise
      .catch((e) => {
        if (!(e instanceof CancelledError)) this.stats.errors += 1;
      })
      .finally(() => {
        if (this.inFlight.get(memKey) === req) this.inFlight.delete(memKey);
      });

    return req;
  }
}

export const imageCache = new ImageCacheImpl();
export { CancelledError };
