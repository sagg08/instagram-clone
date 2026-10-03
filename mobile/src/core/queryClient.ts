import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { ApiError } from './api/client';

/**
 * React Query es la caché en memoria de los datos del servidor:
 * deduplica peticiones, reintenta, y permite actualizaciones optimistas con rollback.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 s sin volver a pedir lo mismo
      // Los datos se guardan en disco (ver persistence.ts) hasta 24 h: deben vivir
      // al menos ese tiempo en memoria para poder persistirse.
      gcTime: 24 * 60 * 60 * 1000,
      // No reintentar errores del cliente (4xx): repetirlos daría el mismo resultado.
      retry: (failureCount, error) =>
        error instanceof ApiError && !error.isRetryable ? false : failureCount < 2,
    },
  },
});

/** Claves de caché centralizadas: evita errores de tipeo al invalidar. */
export const qk = {
  me: ['me'] as const,
  feed: ['feed'] as const,
  post: (id: string) => ['post', id] as const,
  comments: (postId: string) => ['comments', postId] as const,
  profile: (username: string) => ['profile', username] as const,
  userPosts: (userId: string) => ['userPosts', userId] as const,
  connections: (userId: string, kind: 'followers' | 'following') => ['connections', userId, kind] as const,
  search: (q: string) => ['search', q] as const,
  followRequests: ['followRequests'] as const,
  inbox: ['inbox'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  stories: ['stories'] as const,
  storyViews: ['storyViews'] as const,
};

// Sin red, React Query PAUSA las consultas en vez de fallar: la UI sigue mostrando
// lo último que tenía (incluida la caché restaurada de disco).
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
  }),
);

// En móvil no existe "window focus": usamos el estado de la app para que
// React Query refresque los datos al volver a primer plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
}
