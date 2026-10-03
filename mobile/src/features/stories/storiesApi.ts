import { api } from '@/core/api/client';
import type { StoryGroup } from '@/core/types';
import { uploadImage } from '@/features/posts/postsApi';

export const getStoryTray = (signal?: AbortSignal) => api<StoryGroup[]>('/stories', { signal });

/** Sube la imagen al bucket privado "stories" (mismo flujo de signed upload que los posts). */
export async function createStory(localUri: string) {
  const imagePath = await uploadImage(localUri, 'stories');
  return api<{ id: string }>('/stories', { method: 'POST', body: { image_path: imagePath } });
}
