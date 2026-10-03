/**
 * Caché LRU (Least Recently Used) con presupuesto en BYTES y entradas "fijadas" (pinned).
 *
 * Cómo logra O(1):
 *   Un Map de JavaScript conserva el ORDEN DE INSERCIÓN. Al leer una entrada la
 *   borramos y la volvemos a insertar: queda al FINAL (la más reciente).
 *   Por lo tanto, el PRINCIPIO del Map es siempre la menos usada recientemente.
 *   get / set / delete son O(1); el desalojo recorre desde el principio.
 *
 * Por qué "pinned" (idea tomada de Glide/Android: "active resources"):
 *   Una imagen que está en pantalla en este momento NO debe liberarse aunque sea
 *   la más antigua: si liberamos su memoria nativa mientras se dibuja, la celda
 *   quedaría en blanco o la app podría fallar. Solo se desalojan entradas no fijadas.
 *
 * Es código puro (sin React Native) para poder probarlo de forma aislada.
 */
type Entry<V> = { value: V; bytes: number; pins: number };

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    /** Se llama al desalojar: aquí se libera la memoria nativa del bitmap. */
    private readonly onEvict: (key: K, value: V) => void = () => {},
  ) {}

  get size() {
    return this.map.size;
  }

  get bytes() {
    return this.totalBytes;
  }

  has(key: K) {
    return this.map.has(key);
  }

  /** Lee y marca como "usada recientemente" (la mueve al final). */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, bytes: number) {
    const existing = this.map.get(key);
    if (existing) {
      // Reemplazo: liberamos la versión anterior si era otro objeto.
      this.totalBytes -= existing.bytes;
      this.map.delete(key);
      if (existing.value !== value) this.onEvict(key, existing.value);
    }
    this.map.set(key, { value, bytes, pins: existing?.pins ?? 0 });
    this.totalBytes += bytes;
    this.evictIfNeeded();
  }

  /** Fija la entrada mientras está visible. Devuelve false si no existe. */
  pin(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    entry.pins += 1;
    return true;
  }

  unpin(key: K) {
    const entry = this.map.get(key);
    if (!entry) return;
    entry.pins = Math.max(0, entry.pins - 1);
    // Al soltarse, puede que estuviéramos por encima del presupuesto por culpa de entradas fijadas.
    if (entry.pins === 0) this.evictIfNeeded();
  }

  delete(key: K) {
    const entry = this.map.get(key);
    if (!entry) return;
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
    this.onEvict(key, entry.value);
  }

  /**
   * Libera todo lo que NO está en pantalla. Se usa ante una advertencia de
   * memoria del sistema operativo, antes de que el SO mate la app (OOM).
   */
  trimUnpinned() {
    for (const [key, entry] of this.map) {
      if (entry.pins === 0) this.delete(key);
    }
  }

  /** Desaloja desde la menos reciente, saltando las fijadas, hasta caber en el presupuesto. */
  private evictIfNeeded() {
    if (this.totalBytes <= this.maxBytes) return;
    for (const [key, entry] of this.map) {
      if (this.totalBytes <= this.maxBytes) break;
      if (entry.pins === 0) this.delete(key);
    }
    // Si aún se excede, todo lo restante está en pantalla: se tolera temporalmente
    // y se reintenta en el próximo unpin().
  }
}
