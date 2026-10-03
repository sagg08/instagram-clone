import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export type PrivateBucket = 'posts' | 'stories';

/**
 * Firma muchas rutas en UNA sola petición (evita N+1 llamadas a Storage).
 * Devuelve un mapa path -> URL firmada temporal.
 *
 * Importante para el módulo 2: la app debe usar el PATH como clave de caché,
 * no la URL firmada, porque el token de la URL cambia en cada petición.
 */
export async function signPaths(
  db: SupabaseClient,
  bucket: PrivateBucket,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;

  const { data, error } = await db.storage.from(bucket).createSignedUrls(unique, env.SIGNED_URL_TTL);
  if (error) {
    console.error('[storage] error firmando URLs', error.message);
    return urls; // degradación: el post se muestra sin imagen en vez de romper todo el feed
  }
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** Los avatares viven en un bucket público: su URL es fija y no requiere firma. */
export function avatarUrl(db: SupabaseClient, path: string | null): string | null {
  return path ? db.storage.from('avatars').getPublicUrl(path).data.publicUrl : null;
}
