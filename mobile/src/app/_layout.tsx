import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { persistOptions } from '@/core/persistence';
import '@/core/sync/registerSyncHandlers'; // registra cómo se sincroniza cada tipo de acción
import { queryClient } from '@/core/queryClient';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { CenteredMessage } from '@/shared/ui/controls';

/**
 * Navegador raíz. Stack.Protected decide qué rutas EXISTEN según haya sesión:
 *  - sin sesión: solo (auth)
 *  - con sesión: las pestañas y los modales
 * Si la sesión cambia (login/logout), el router redirige automáticamente.
 */
function RootNavigator() {
  const { session, loading } = useAuth();
  if (loading) return <CenteredMessage loading />;

  const signedIn = Boolean(session);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="create"
          options={{ presentation: 'modal', headerShown: true, title: 'Nueva publicación' }}
        />
        <Stack.Screen name="stories/[authorId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    // Restaura la caché guardada en SQLite al abrir la app (feed disponible sin internet).
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
