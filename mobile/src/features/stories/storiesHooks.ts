import { useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk, queryClient } from '@/core/queryClient';
import type { StoryGroup } from '@/core/types';
import * as storiesApi from './storiesApi';
import { loadSeenStoryIds, saveStorySeen } from './storyViews';

/** Conjunto de ids de historias vistas (leído de SQLite una vez y mantenido en memoria). */
export function useSeenStories() {
  return useQuery({
    queryKey: qk.storyViews,
    queryFn: loadSeenStoryIds,
    staleTime: Infinity, // la fuente de verdad es local: solo cambia cuando YO veo una historia
    networkMode: 'always', // es SQLite, no red: funciona sin conexión
  });
}

export const isGroupSeen = (g: StoryGroup, seen: Set<string> | undefined) =>
  Boolean(seen) && g.items.every((i) => seen!.has(i.id));

/**
 * Bandeja ordenada como Instagram: mi historia primero, luego las que tienen
 * historias SIN VER, y al final las ya vistas.
 */
export function useStoryTray() {
  const tray = useQuery({ queryKey: qk.stories, queryFn: ({ signal }) => storiesApi.getStoryTray(signal) });
  const seen = useSeenStories();

  const groups = useMemo(() => {
    const data = tray.data ?? [];
    const mine = data.filter((g) => g.is_me);
    const others = data.filter((g) => !g.is_me);
    const unseen = others.filter((g) => !isGroupSeen(g, seen.data));
    const done = others.filter((g) => isGroupSeen(g, seen.data));
    return [...mine, ...unseen, ...done];
  }, [tray.data, seen.data]);

  return { groups, seen: seen.data, isPending: tray.isPending, refetch: tray.refetch };
}

/** Marca como vista: actualiza la memoria al instante y persiste en SQLite. */
export function useMarkStorySeen() {
  return useCallback((storyId: string) => {
    const current = queryClient.getQueryData<Set<string>>(qk.storyViews);
    if (current?.has(storyId)) return;
    queryClient.setQueryData<Set<string>>(qk.storyViews, (prev) => new Set([...(prev ?? []), storyId]));
    saveStorySeen(storyId).catch(() => {}); // si falla, solo se pierde el anillo gris: no es crítico
  }, []);
}

export function useCreateStory() {
  return useMutation({
    mutationFn: (uri: string) => storiesApi.createStory(uri),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.stories }),
  });
}
