import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useCachedImage } from '@/core/imageCache/useCachedImage';
import { colors } from './theme';

type Props = {
  /** Clave estable de la imagen (path en Storage o URL pública fija). */
  cacheKey: string;
  /** URL de descarga (puede ser una signed URL temporal). */
  uri: string | null;
  /** Ancho en pantalla (pt): define a qué tamaño se decodifica el bitmap. */
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Punto ÚNICO por el que la app muestra imágenes remotas.
 * Usa NUESTRO motor de caché (useCachedImage). A expo-image solo le pedimos
 * dibujar un bitmap que ya está en memoria: cachePolicy="none" desactiva
 * su propia caché para que no haya una segunda caché oculta "sin control".
 */
export function RemoteImage({ cacheKey, uri, width, height, style }: Props) {
  const { ref, error, recyclingKey } = useCachedImage(cacheKey, uri, width);
  const box = [{ width, height, backgroundColor: colors.surface }, style];

  if (error) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="image-outline" size={Math.min(32, width / 3)} color={colors.muted} />
      </View>
    );
  }
  // El contenedor define tamaño y forma (ej. borderRadius del avatar); la imagen lo llena.
  return (
    <View style={[box, { overflow: 'hidden' }]}>
      {ref && (
        <Image
          source={ref}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="none"
          recyclingKey={recyclingKey} // con celdas recicladas, limpia la imagen anterior al instante
          transition={0}
        />
      )}
    </View>
  );
}
