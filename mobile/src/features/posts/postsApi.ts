import { File, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, ApiError } from '@/core/api/client';
import type { Cursor, GridPost, Page, Post } from '@/core/types';

// Capa de datos de posts: funciones puras que hablan con la API (sin React).

const cursorQuery = (cursor: Cursor) => ({
  cursor_created_at: cursor?.created_at,
  cursor_id: cursor?.id,
});

export const getFeed = (cursor: Cursor, signal?: AbortSignal) =>
  api<Page<Post>>('/feed', { query: { ...cursorQuery(cursor), limit: 10 }, signal });

export const getPost = (id: string, signal?: AbortSignal) => api<Post>(`/posts/${id}`, { signal });

export const getUserPosts = (userId: string, cursor: Cursor, signal?: AbortSignal) =>
  api<Page<GridPost>>(`/users/${userId}/posts`, { query: { ...cursorQuery(cursor), limit: 30 }, signal });

/** PUT con el estado final (idempotente): repetirlo no cambia el resultado. */
export const setLike = (postId: string, liked: boolean) =>
  api<{ post_id: string; liked: boolean; like_count: number }>(`/posts/${postId}/like`, {
    method: 'PUT',
    body: { liked },
  });

/**
 * Comprime la foto antes de subirla: 1080 px de ancho (lo que muestra Instagram)
 * y JPEG al 80 %. Una foto de iPhone pasa de ~4 MB a ~200 KB:
 * menos datos móviles, subida más rápida y menos RAM al decodificar en el feed.
 */
async function compressImage(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1080 }).renderAsync();
  const result = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return result.uri;
}

/**
 * Subida en 3 pasos:
 *  1) la API genera una URL firmada para MI carpeta en Storage
 *  2) el archivo se sube DIRECTO a Storage (no pasa por Express)
 *  3) la API crea el post con el path
 * El paso 2 lo hace el código nativo leyendo desde disco (streaming):
 * el archivo nunca se carga completo en la memoria de JavaScript.
 */
export async function uploadImage(localUri: string, bucket: 'posts' | 'stories' | 'avatars') {
  const compressedUri = await compressImage(localUri);
  const signed = await api<{ path: string; signed_url: string }>('/uploads/sign', {
    method: 'POST',
    body: { bucket, content_type: 'image/jpeg' },
  });

  const result = await new File(compressedUri).upload(signed.signed_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, 'UPLOAD_FAILED', 'No se pudo subir la imagen');
  }
  return signed.path;
}

export async function createPost(localUri: string, caption: string) {
  const imagePath = await uploadImage(localUri, 'posts');
  return api<Post>('/posts', { method: 'POST', body: { image_path: imagePath, caption: caption.trim() || null } });
}

export const deletePost = (id: string) => api<void>(`/posts/${id}`, { method: 'DELETE' });
