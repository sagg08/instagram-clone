import { useCallback } from 'react';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import type { Post } from '@/core/types';
import { qk, queryClient } from '@/core/queryClient';
import { useFeed } from '@/features/posts/postsHooks';
import { PostCard } from '@/features/posts/components/PostCard';
import { CenteredMessage } from '@/shared/ui/controls';
import { SyncStatusBanner } from '@/shared/ui/SyncStatusBanner';
import { StoryTray } from '@/features/stories/components/StoryTray';

/**
 * Feed con FlashList (módulo 2, 60 FPS).
 *
 * FlatList crea un componente NUEVO por cada post que entra a pantalla y destruye
 * los que salen: con scroll largo eso significa asignar y liberar memoria sin parar
 * (presión sobre el recolector de basura -> tirones).
 * FlashList RECICLA: mantiene un pool fijo de celdas y, cuando una sale por arriba,
 * la reutiliza abajo con los datos del siguiente post. La memoria queda estable sin
 * importar si el feed tiene 10 o 10 000 posts.
 */
export default function FeedScreen() {
  const feed = useFeed();
  const posts = feed.data?.pages.flatMap((p) => p.items) ?? [];

  // renderItem estable (useCallback): FlashList no re-renderiza celdas por recibir una función nueva.
  const renderItem = useCallback<ListRenderItem<Post>>(({ item }) => <PostCard post={item} />, []);

  if (feed.isPending) {
    // Sin red y sin nada guardado aún: la consulta queda en pausa, no es un error.
    if (feed.fetchStatus === 'paused') {
      return <CenteredMessage title="Sin conexión" subtitle="El feed se cargará cuando vuelva internet." />;
    }
    return <CenteredMessage loading />;
  }
  if (feed.error && posts.length === 0) {
    return <CenteredMessage title="No se pudo cargar el feed" subtitle={feed.error.message} />;
  }

  return (
    <FlashList
      data={posts}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      drawDistance={800} // pre-renderiza ~1 pantalla por debajo: la imagen ya está cargando antes de verse
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
      onEndReachedThreshold={0.6} // pide la siguiente página antes de llegar al final
      refreshing={feed.isRefetching}
      onRefresh={() => {
        feed.refetch();
        void queryClient.invalidateQueries({ queryKey: qk.stories });
      }}
      ListHeaderComponent={
        <>
          <SyncStatusBanner />
          <StoryTray />
        </>
      }
      ListEmptyComponent={
        <CenteredMessage title="Tu feed está vacío" subtitle="Publica algo o sigue a otras personas desde Explorar." />
      }
    />
  );
}
