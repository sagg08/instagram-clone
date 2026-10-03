import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/shared/ui/theme';
import { useUnreadTotal } from '../messagesHooks';

/** Ícono de mensajes del encabezado, con globito de no leídos. */
export function InboxButton() {
  const unread = useUnreadTotal();
  return (
    <Pressable onPress={() => router.push('/inbox')} hitSlop={10} accessibilityLabel={`Mensajes, ${unread} sin leer`}>
      <Ionicons name="paper-plane-outline" size={26} />
      {unread > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: colors.like,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}
