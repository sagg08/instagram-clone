import { Text, View } from 'react-native';
import { RemoteImage } from './RemoteImage';
import { colors } from './theme';

/** Avatar circular; sin foto muestra la inicial. También pasa por nuestro motor de caché. */
export function Avatar({ uri, username, size = 32 }: { uri: string | null; username: string; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' as const };
  if (uri) {
    // La URL pública del avatar es estable: sirve directamente como clave de caché.
    return <RemoteImage cacheKey={uri} uri={uri} width={size} height={size} style={shape} />;
  }
  return (
    <View style={[shape, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: size * 0.42, fontWeight: '600', color: colors.muted }}>
        {username.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
