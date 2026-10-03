import { useEffect, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import type { ImageRef } from 'expo-image';
import { CancelledError, imageCache } from './ImageCache';

/**
 * Agrupa anchos en múltiplos de 128 px: 1179 y 1170 px usan el mismo bitmap
 * en vez de dos casi idénticos (más aciertos en RAM, menos memoria).
 */
export const bucket = (logicalWidth: number) => {
  const px = PixelRatio.getPixelSizeForLayoutSize(logicalWidth);
  return Math.max(128, Math.ceil(px / 128) * 128);
};

type State = { memKey: string | null; ref: ImageRef | null; error: boolean };

/**
 * Hook que conecta una celda con el motor de caché.
 *
 * Ciclo de vida (clave para el reciclaje de FlashList):
 *  - FlashList NO destruye las celdas al salir de pantalla: las REUTILIZA para otro
 *    post, cambiando sus props. Por eso el efecto depende de memKey: cuando la celda
 *    se recicla, la limpieza del efecto anterior CANCELA la descarga que ya no
 *    hace falta y suelta (unpin) la imagen anterior.
 *  - Lo mismo ocurre si la celda se desmonta: cancel + unpin. Así no quedan
 *    promesas vivas apuntando a componentes muertos (fuga de memoria).
 */
export function useCachedImage(storageKey: string | null, url: string | null, logicalWidth: number) {
  const pixelWidth = bucket(logicalWidth);
  const memKey = storageKey ? imageCache.memoryKey(storageKey, pixelWidth) : null;

  // La URL firmada cambia en cada refresco del feed (nuevo token) aunque la imagen
  // sea la misma: la guardamos en un ref para NO reiniciar la carga por eso.
  const urlRef = useRef(url);
  urlRef.current = url;

  const [state, setState] = useState<State>({ memKey: null, ref: null, error: false });

  // Acierto en RAM leído durante el render: la imagen aparece en el MISMO frame.
  const memoryHit = memKey ? imageCache.peek(memKey) : undefined;

  useEffect(() => {
    if (!storageKey || !memKey) return;

    // Si sigue en RAM, la fijamos (visible: que la LRU no la libere). Si pin() falla es
    // porque la desalojaron entre el render y este efecto: caemos a la carga normal.
    if (imageCache.peek(memKey) && imageCache.pin(memKey)) {
      imageCache.recordMemoryHit();
      return () => imageCache.unpin(memKey);
    }

    let alive = true;
    let pinned = false;
    const { promise, cancel } = imageCache.load(storageKey, urlRef.current, pixelWidth);

    promise
      .then((ref) => {
        if (!alive) return;
        pinned = imageCache.pin(memKey);
        setState({ memKey, ref, error: false });
      })
      .catch((e) => {
        if (alive && !(e instanceof CancelledError)) setState({ memKey, ref: null, error: true });
      });

    return () => {
      alive = false;
      cancel();
      if (pinned) imageCache.unpin(memKey);
    };
  }, [storageKey, memKey, pixelWidth]);

  const isCurrent = state.memKey === memKey;
  return {
    ref: memoryHit ?? (isCurrent ? state.ref : null),
    error: isCurrent && state.error,
    recyclingKey: memKey ?? undefined,
  };
}
