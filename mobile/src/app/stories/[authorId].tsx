import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { imageCache } from '@/core/imageCache/ImageCache';
import { bucket, useCachedImage } from '@/core/imageCache/useCachedImage';
import type { StoryGroup } from '@/core/types';
import { useMarkStorySeen, useStoryTray } from '@/features/stories/storiesHooks';
import { Avatar } from '@/shared/ui/Avatar';

const STORY_MS = 5000; // cada historia dura 5 s

/** Primera historia sin ver del grupo (Instagram retoma donde lo dejaste). */
const firstUnseen = (g: StoryGroup, seen: Set<string> | undefined) => {
  const i = g.items.findIndex((it) => !seen?.has(it.id));
  return i === -1 ? 0 : i;
};

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? 'hace un momento' : `${h} h`;
}

/**
 * VISOR DE HISTORIAS (pantalla completa).
 *
 * Barras de progreso: se animan con useNativeDriver = true. La animación se envía
 * UNA vez al hilo de UI (nativo) y corre allí a 60 FPS sin pasar por JavaScript en
 * cada frame: aunque el hilo de JS esté ocupado (descargas, SQLite), la barra no se traba.
 *
 * Pausa: al mantener presionado, stopAnimation() devuelve el progreso exacto
 * (ej. 0,42). Al soltar, se reanuda con el tiempo restante: (1 - 0,42) × 5 s.
 *
 * El temporizador NO arranca hasta que la imagen está decodificada: con red lenta,
 * la historia no "se gasta" mientras aún se ve en negro.
 */
export default function StoryViewer() {
  const { authorId } = useLocalSearchParams<{ authorId: string }>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { groups, seen } = useStoryTray();
  const markSeen = useMarkStorySeen();

  // La lista de grupos se "congela" al abrir: si mientras ves historias otro grupo
  // pasa a "visto" y la bandeja se reordena, no queremos saltar de autor.
  const frozen = useRef<StoryGroup[] | null>(null);
  if (!frozen.current && groups.length > 0) frozen.current = groups;
  const list = frozen.current ?? [];

  const [gi, setGi] = useState(() => Math.max(0, list.findIndex((g) => g.author.id === authorId)));
  const group = list[gi];
  const [ii, setIi] = useState(() => (group ? firstUnseen(group, seen) : 0));
  const item = group?.items[ii];

  const { ref } = useCachedImage(item?.image_path ?? null, item?.image_url ?? null, width);
  const progress = useRef(new Animated.Value(0)).current;
  const pausedAt = useRef(0);

  const next = useCallback(() => {
    if (!group) return;
    if (ii + 1 < group.items.length) setIi(ii + 1);
    else if (gi + 1 < list.length) {
      setGi(gi + 1);
      setIi(firstUnseen(list[gi + 1]!, seen));
    } else router.back();
  }, [group, ii, gi, list, seen]);

  const prev = useCallback(() => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setIi(list[gi - 1]!.items.length - 1);
    } else {
      progress.setValue(0); // primera de todas: reinicia
      pausedAt.current = 0;
    }
  }, [ii, gi, list, progress]);

  // "next" cambia cuando cambia el estado "visto"; si la animación dependiera de él,
  // marcar una historia como vista REINICIARÍA la barra. Se lee siempre la última versión vía ref.
  const nextRef = useRef(next);
  nextRef.current = next;

  const run = useCallback(
    (from: number) => {
      Animated.timing(progress, {
        toValue: 1,
        duration: (1 - from) * STORY_MS,
        useNativeDriver: true,
      }).start(({ finished }) => finished && nextRef.current());
    },
    [progress],
  );

  // Nueva historia en pantalla: reiniciar barra; arrancar cuando la imagen esté lista.
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    pausedAt.current = 0;
    if (!item || !ref) return;
    markSeen(item.id); // persistido en SQLite
    run(0);
    return () => progress.stopAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reiniciar al cambiar de historia o al cargar la imagen
  }, [item?.id, ref]);

  // Precarga de la SIGUIENTE historia: al pasar, la imagen ya está en RAM (sin pantalla negra).
  const upcoming = group?.items[ii + 1] ?? list[gi + 1]?.items[0];
  useEffect(() => {
    if (!upcoming) return;
    const { promise, cancel } = imageCache.load(upcoming.image_path, upcoming.image_url, bucket(width));
    promise.catch(() => {});
    return cancel; // si salimos antes de que termine, se cancela la descarga
  }, [upcoming?.id, width]);

  const pause = () => progress.stopAnimation((v) => (pausedAt.current = v));
  const resume = () => {
    if (ref) run(pausedAt.current);
  };

  if (!group || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff' }}>Esta historia ya no está disponible</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Cerrar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar hidden />
      {ref && <Image source={ref} style={{ width, height }} contentFit="cover" cachePolicy="none" transition={0} />}

      {/* Zona táctil: tocar izquierda = anterior, derecha = siguiente; mantener = pausa */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPressIn={pause}
        onPressOut={resume}
        onPress={(e) => (e.nativeEvent.locationX < width * 0.3 ? prev() : next())}
        delayLongPress={200}
        onLongPress={() => {}} // un "long press" solo pausa: no navega al soltar
      />

      <View style={{ position: 'absolute', top: insets.top + 8, left: 8, right: 8, gap: 10 }} pointerEvents="box-none">
        {/* Barras de progreso: una por historia del autor */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {group.items.map((it, idx) => (
            <View key={it.id} style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: '#fff',
                  transformOrigin: 'left',
                  // Completas = llenas; la actual = animada (en el hilo nativo); siguientes = vacías.
                  transform: [{ scaleX: idx < ii ? 1 : idx === ii ? progress : 0 }],
                }}
              />
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} pointerEvents="box-none">
          <Avatar uri={group.author.avatar_url} username={group.author.username} size={32} />
          <Text style={{ color: '#fff', fontWeight: '700' }}>{group.is_me ? 'Tu historia' : group.author.username}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)' }}>{timeAgo(item.created_at)}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cerrar">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
