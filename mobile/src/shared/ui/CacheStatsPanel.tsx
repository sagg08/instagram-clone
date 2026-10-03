import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { imageCache } from '@/core/imageCache/ImageCache';
import { colors, spacing } from './theme';

type Stats = Awaited<ReturnType<typeof imageCache.getStats>>;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Panel de diagnóstico del motor de caché (solo en desarrollo).
 * Para la demo: "Vaciar" -> recorrer el feed (suben las descargas de red) ->
 * volver (suben los aciertos de RAM) -> cerrar y abrir la app (suben los de disco).
 */
export function CacheStatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  const refresh = useCallback(() => {
    imageCache.getStats().then(setStats).catch(() => {});
  }, []);

  // Se actualiza cada vez que vuelves a la pestaña Perfil.
  useFocusEffect(refresh);

  if (!stats) return null;
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 8, padding: spacing.md, gap: 4 }}>
      <Text style={{ fontWeight: '700' }}>Motor de caché (dev)</Text>
      <Text>RAM: {stats.memory.entries} bitmaps · {mb(stats.memory.bytes)} / {mb(stats.memory.maxBytes)}</Text>
      <Text>Disco: {stats.disk.files} archivos · {mb(stats.disk.bytes)} / {mb(stats.disk.maxBytes)}</Text>
      <Text>
        Aciertos RAM {stats.memoryHits} · disco {stats.diskHits} · red {stats.networkLoads}
      </Text>
      <Text>
        Canceladas {stats.cancelled} · errores {stats.errors} · cola {stats.queue.queued}/{stats.queue.active}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 4 }}>
        <Pressable onPress={refresh} hitSlop={8}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Actualizar</Text>
        </Pressable>
        <Pressable onPress={() => imageCache.clearAll().then(refresh)} hitSlop={8}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Vaciar caché</Text>
        </Pressable>
      </View>
    </View>
  );
}
