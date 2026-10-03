import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/shared/ui/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMessagesRealtime } from '@/features/messages/messagesHooks';

type IconName = keyof typeof Ionicons.glyphMap;

const icon = (active: IconName, inactive: IconName) =>
  ({ focused, size }: { focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={colors.text} />
  );

/**
 * Barra inferior persistente con 4 pestañas. Cada pestaña es un GRUPO que contiene
 * su PROPIO Stack (ver (home,explore,activity,profile)/_layout.tsx), así que cada una
 * conserva su historial: si navegas a un post en Home y cambias a Perfil, al volver
 * a Home sigues en ese post (módulo 5: pilas de navegación independientes).
 */
export default function TabsLayout() {
  // Una sola suscripción Realtime a mensajes mientras hay sesión (ver messagesHooks).
  const { session } = useAuth();
  useMessagesRealtime(session?.user.id);

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarActiveTintColor: colors.text }}>
      <Tabs.Screen name="(home)" options={{ tabBarIcon: icon('home', 'home-outline'), title: 'Inicio' }} />
      <Tabs.Screen name="(explore)" options={{ tabBarIcon: icon('search', 'search-outline'), title: 'Explorar' }} />
      <Tabs.Screen name="(activity)" options={{ tabBarIcon: icon('heart', 'heart-outline'), title: 'Actividad' }} />
      <Tabs.Screen name="(profile)" options={{ tabBarIcon: icon('person-circle', 'person-circle-outline'), title: 'Perfil' }} />
    </Tabs>
  );
}
