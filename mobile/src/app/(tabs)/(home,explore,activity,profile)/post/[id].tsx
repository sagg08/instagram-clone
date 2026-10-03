import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ApiError } from '@/core/api/client';
import { usePost } from '@/features/posts/postsHooks';
import { PostCard } from '@/features/posts/components/PostCard';
import { CenteredMessage } from '@/shared/ui/controls';

/**
 * Detalle de publicación. Es también el destino del deep link instagramclone://post/{id}.
 * Si el post es de una cuenta privada que no sigues, la API responde 404
 * (no revela que existe) y mostramos un mensaje neutro.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, isPending } = usePost(id);

  if (isPending) return <CenteredMessage loading />;
  if (error) {
    const unavailable = error instanceof ApiError && (error.status === 404 || error.status === 400);
    return (
      <CenteredMessage
        title={unavailable ? 'Esta publicación no está disponible' : 'No se pudo cargar la publicación'}
        subtitle={unavailable ? 'Puede que se haya eliminado o que la cuenta sea privada.' : undefined}
      />
    );
  }
  return (
    <ScrollView>
      <PostCard post={data} />
    </ScrollView>
  );
}
