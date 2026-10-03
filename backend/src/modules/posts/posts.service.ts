import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrap, unwrapMaybe, assertOk, notFound, HttpError } from '../../lib/errors.js';
import { signPaths, avatarUrl } from '../../lib/storage.js';
import { nextCursor, type Cursor } from '../../lib/schemas.js';
import { canViewContent } from '../profiles/profiles.service.js';

type FeedRow = {
  id: string;
  author_id: string;
  username: string;
  avatar_path: string | null;
  image_path: string;
  caption: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

/** Forma única de un post hacia la app (el mismo shape en feed, detalle y deep link). */
async function toPostDtos(db: SupabaseClient, rows: FeedRow[]) {
  const urls = await signPaths(db, 'posts', rows.map((r) => r.image_path));
  return rows.map((r) => ({
    id: r.id,
    author: { id: r.author_id, username: r.username, avatar_url: avatarUrl(db, r.avatar_path) },
    image_path: r.image_path, // clave estable para la caché de imágenes (módulo 2)
    image_url: urls.get(r.image_path) ?? null, // URL temporal para descargarla
    caption: r.caption,
    created_at: r.created_at,
    like_count: Number(r.like_count), // bigint llega como string/number según el driver
    comment_count: Number(r.comment_count),
    liked_by_me: r.liked_by_me,
  }));
}

/** Feed: posts propios + de cuentas que sigo (aceptadas), paginado por cursor. */
export async function getFeed(
  db: SupabaseClient,
  cursor: { created_at?: string; id?: string },
  limit: number,
) {
  const rows = unwrap(
    await db.rpc('get_feed', {
      p_cursor_created_at: cursor.created_at ?? null,
      p_cursor_id: cursor.id ?? null,
      p_limit: limit,
    }),
  ) as FeedRow[];

  return { items: await toPostDtos(db, rows), next_cursor: nextCursor(rows, limit) as Cursor };
}

export async function createPost(
  db: SupabaseClient,
  me: string,
  input: { image_path: string; caption?: string | null },
) {
  // El path debe ser de MI carpeta: impide publicar como propia la imagen de otra persona.
  if (!input.image_path.startsWith(`${me}/`)) {
    throw new HttpError(403, 'FORBIDDEN', 'Ruta de imagen no permitida');
  }
  const created = unwrap(
    await db
      .from('posts')
      .insert({ author_id: me, image_path: input.image_path, caption: input.caption ?? null })
      .select('id')
      .single(),
  );
  return getPost(db, me, created.id);
}

/** Detalle de un post (lo usa también el deep link instagramclone://post/{id}). */
export async function getPost(db: SupabaseClient, me: string, postId: string) {
  // RLS: si el post es de una cuenta privada que no sigo, simplemente NO aparece -> 404.
  // Devolvemos 404 (no 403) para no revelar que el post existe.
  const post = unwrapMaybe(
    await db
      .from('posts')
      .select('id, author_id, image_path, caption, created_at, author:profiles!posts_author_id_fkey(username, avatar_path)')
      .eq('id', postId)
      .maybeSingle(),
  ) as unknown as
    | (Omit<FeedRow, 'username' | 'avatar_path' | 'like_count' | 'comment_count' | 'liked_by_me'> & {
        author: { username: string; avatar_path: string | null };
      })
    | null;
  if (!post) throw notFound('Post');

  const [likes, comments, mine] = await Promise.all([
    db.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    db.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    db.from('likes').select('user_id').eq('post_id', postId).eq('user_id', me).maybeSingle(),
  ]);

  const [dto] = await toPostDtos(db, [
    {
      id: post.id,
      author_id: post.author_id,
      username: post.author.username,
      avatar_path: post.author.avatar_path,
      image_path: post.image_path,
      caption: post.caption,
      created_at: post.created_at,
      like_count: likes.count ?? 0,
      comment_count: comments.count ?? 0,
      liked_by_me: Boolean(unwrapMaybe(mine)),
    },
  ]);
  return dto;
}

/** Grilla de un perfil (solo miniaturas). */
export async function listUserPosts(
  db: SupabaseClient,
  userId: string,
  cursor: { created_at?: string; id?: string },
  limit: number,
) {
  if (!(await canViewContent(db, userId))) {
    throw new HttpError(403, 'PRIVATE_ACCOUNT', 'Esta cuenta es privada');
  }

  let query = db
    .from('posts')
    .select('id, image_path, created_at')
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  // Equivalente a (created_at, id) < (cursor) en SQL, expresado con el query builder.
  if (cursor.created_at && cursor.id) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const rows = unwrap(await query);
  const urls = await signPaths(db, 'posts', rows.map((r) => r.image_path));
  return {
    items: rows.map((r) => ({ ...r, image_url: urls.get(r.image_path) ?? null })),
    next_cursor: nextCursor(rows, limit),
  };
}

export async function deletePost(db: SupabaseClient, postId: string) {
  // RLS solo deja borrar posts propios; si no es tuyo, 0 filas afectadas -> 404.
  const rows = unwrap(await db.from('posts').delete().eq('id', postId).select('image_path'));
  const deleted = rows[0];
  if (!deleted) throw notFound('Post');
  await db.storage.from('posts').remove([deleted.image_path]); // limpieza best-effort
}

/**
 * Like con ESTADO FINAL, no toggle: PUT { liked: true|false }.
 * Clave para la cola offline (módulo 3): si el usuario hace like/unlike/like
 * sin red y la cola reenvía las 3 acciones, el resultado final es el correcto.
 * Repetir la misma petición N veces da el mismo resultado (idempotencia).
 */
export async function setLike(db: SupabaseClient, me: string, postId: string, liked: boolean) {
  if (liked) {
    // ON CONFLICT DO NOTHING: si ya existía el like, no falla ni duplica.
    assertOk(
      await db
        .from('likes')
        .upsert({ post_id: postId, user_id: me }, { onConflict: 'post_id,user_id', ignoreDuplicates: true }),
    );
  } else {
    assertOk(await db.from('likes').delete().eq('post_id', postId).eq('user_id', me));
  }

  const { count } = await db.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  return { post_id: postId, liked, like_count: count ?? 0 };
}
