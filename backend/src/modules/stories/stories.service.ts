import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, notFound, unwrap } from '../../lib/errors.js';
import { avatarUrl, signPaths } from '../../lib/storage.js';

type StoryRow = {
  id: string;
  author_id: string;
  image_path: string;
  created_at: string;
  expires_at: string;
  author: { username: string; avatar_path: string | null };
};

/** Publica una historia. Caduca sola a las 24 h (default de expires_at en la tabla). */
export async function createStory(db: SupabaseClient, me: string, imagePath: string) {
  if (!imagePath.startsWith(`${me}/`)) {
    throw new HttpError(403, 'FORBIDDEN', 'Ruta de imagen no permitida');
  }
  const row = unwrap(
    await db.from('stories').insert({ author_id: me, image_path: imagePath }).select('id, created_at, expires_at').single(),
  );
  return row;
}

/**
 * Bandeja de historias: las mías primero y luego las de cuentas que sigo (aceptadas),
 * agrupadas por autor y ordenadas por la historia más reciente.
 *
 * El filtro de 24 h lo hace la base de datos dos veces: aquí (expires_at > now) y en
 * el RLS de stories. Aunque alguien llame a Supabase directamente, una historia
 * caducada ya no se puede leer.
 */
export async function getStoryTray(db: SupabaseClient, me: string) {
  const following = unwrap(
    await db.from('follows').select('following_id').eq('follower_id', me).eq('status', 'accepted'),
  ) as { following_id: string }[];
  const authorIds = [me, ...following.map((f) => f.following_id)];

  const rows = unwrap(
    await db
      .from('stories')
      .select('id, author_id, image_path, created_at, expires_at, author:profiles!stories_author_id_fkey(username, avatar_path)')
      .in('author_id', authorIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(500),
  ) as unknown as StoryRow[];

  // Una sola petición a Storage para firmar todas las imágenes (no N peticiones).
  const urls = await signPaths(db, 'stories', rows.map((r) => r.image_path));

  const groups = new Map<
    string,
    { author: { id: string; username: string; avatar_url: string | null }; is_me: boolean; latest_at: string; items: unknown[] }
  >();
  for (const r of rows) {
    let g = groups.get(r.author_id);
    if (!g) {
      g = {
        author: { id: r.author_id, username: r.author.username, avatar_url: avatarUrl(db, r.author.avatar_path) },
        is_me: r.author_id === me,
        latest_at: r.created_at,
        items: [],
      };
      groups.set(r.author_id, g);
    }
    g.latest_at = r.created_at; // vienen ascendentes: la última asignada es la más reciente
    g.items.push({
      id: r.id,
      image_path: r.image_path, // clave estable para la caché de imágenes
      image_url: urls.get(r.image_path) ?? null,
      created_at: r.created_at,
      expires_at: r.expires_at,
    });
  }

  // Yo primero; los demás, de la historia más nueva a la más vieja.
  return [...groups.values()].sort((a, b) =>
    a.is_me !== b.is_me ? (a.is_me ? -1 : 1) : b.latest_at.localeCompare(a.latest_at),
  );
}

export async function deleteStory(db: SupabaseClient, storyId: string) {
  // RLS: solo el autor puede borrar; si no es suya, 0 filas -> 404.
  const rows = unwrap(await db.from('stories').delete().eq('id', storyId).select('image_path'));
  const deleted = rows[0];
  if (!deleted) throw notFound('Historia');
  await db.storage.from('stories').remove([deleted.image_path]);
}
