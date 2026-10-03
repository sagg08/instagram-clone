import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { confirmSignOut } from '@/features/auth/confirmSignOut';
import { InboxButton } from '@/features/messages/components/InboxButton';

/**
 * RUTAS COMPARTIDAS. El nombre de carpeta "(home,explore,activity,profile)" hace que
 * Expo Router genere 4 copias de este Stack, una dentro de cada pestaña. Las pantallas
 * post/[id] y user/[username] existen en las 4 pilas: abrir un perfil desde Explorar
 * lo apila en Explorar, sin tocar la pila de Inicio.
 *
 * unstable_settings fija la pantalla raíz de cada pila. Sirve para el deep link:
 * instagramclone://post/123 abre el post y "atrás" lleva al feed, no fuera de la app.
 */
export const unstable_settings = {
  home: { initialRouteName: 'index' },
  explore: { initialRouteName: 'explore' },
  activity: { initialRouteName: 'activity' },
  profile: { initialRouteName: 'profile' },
};

export default function SharedStackLayout({ segment }: { segment: string }) {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false }}>
      {segment === '(home)' && (
        <Stack.Screen
          name="index"
          options={{
            title: 'InstaClone',
            headerTitleStyle: { fontSize: 24, fontWeight: '700' },
            headerRight: () => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                <Pressable onPress={() => router.push('/create')} hitSlop={10} accessibilityLabel="Nueva publicación">
                  <Ionicons name="add-circle-outline" size={28} />
                </Pressable>
                <InboxButton />
              </View>
            ),
          }}
        />
      )}
      {segment === '(explore)' && <Stack.Screen name="explore" options={{ title: 'Explorar' }} />}
      {segment === '(activity)' && <Stack.Screen name="activity" options={{ title: 'Actividad' }} />}
      {segment === '(profile)' && (
        <Stack.Screen
          name="profile"
          options={{
            title: 'Perfil',
            headerRight: () => (
              <Pressable onPress={() => void confirmSignOut()} hitSlop={10} accessibilityLabel="Cerrar sesión">
                <Ionicons name="log-out-outline" size={26} />
              </Pressable>
            ),
          }}
        />
      )}
      <Stack.Screen name="post/[id]" options={{ title: 'Publicación' }} />
      <Stack.Screen name="user/[username]" options={{ title: '' }} />
      <Stack.Screen name="comments/[postId]" options={{ title: 'Comentarios' }} />
      <Stack.Screen name="inbox" options={{ title: 'Mensajes' }} />
      <Stack.Screen name="chat/[id]" options={{ title: '' }} />
    </Stack>
  );
}
