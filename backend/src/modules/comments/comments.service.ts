import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrap, unwrapMaybe, assertOk, notFound, HttpError } from '../../lib/errors.js';
import { withAvatar } from '../profiles/profiles.service.js';

const COMMENT_SELECT =
  'id, post_id, parent_id, body, created_at, user:profiles!comments_user_id_fkey(id, username, avatar_path)';

type CommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  user: { id: string; username: string; avatar_path: string | null };
};

const toDto = (db: SupabaseClient, c: CommentRow) => ({ ...c, user: withAvatar(db, c.user) });

/** Todos los comentarios del post en orden cronológico; la app arma el árbol con parent_id. */
export async function listComments(db: SupabaseClient, postId: string) {
  const rows = unwrap(
    await db
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(500),
  ) as unknown as CommentRow[];
  return rows.map((c) => toDto(db, c));
}

/**
 * Crear comentario con ID generado en el CLIENTE.
 * Si la cola offline reintenta y el comentario ya existe (23505), devolvemos el
 * existente con created=false: el reintento es inofensivo (idempotencia).
 */
export async function createComment(
  db: SupabaseClient,
  me: string,
  postId: string,
  input: { id: string; body: string; parent_id?: string | null },
) {
  if (input.parent_id) {
    // Una respuesta debe pertenecer al mismo post que su comentario padre.
    const parent = unwrapMaybe(
      await db.from('comments').select('post_id').eq('id', input.parent_id).maybeSingle(),
    );
    if (!parent || parent.post_id !== postId) {
      throw new HttpError(400, 'INVALID_PARENT', 'El comentario padre no pertenece a este post');
    }
  }

  const { error } = await db.from('comments').insert({
    id: input.id,
    post_id: postId,
    user_id: me,
    parent_id: input.parent_id ?? null,
    body: input.body,
  });

  let created = true;
  if (error?.code === '23505') {
    created = false;
  } else if (error) {
    assertOk({ error });
  }

  const row = unwrapMaybe(
    await db.from('comments').select(`${COMMENT_SELECT}, user_id`).eq('id', input.id).maybeSingle(),
  ) as unknown as (CommentRow & { user_id: string }) | null;

  // Si el UUID ya existía pero es de OTRA persona u otro post, es un conflicto real.
  if (!row || row.user_id !== me || row.post_id !== postId) {
    throw new HttpError(409, 'ID_CONFLICT', 'El id del comentario ya está en uso');
  }

  const { user_id: _omit, ...comment } = row;
  return { created, comment: toDto(db, comment) };
}

export async function deleteComment(db: SupabaseClient, commentId: string) {
  // RLS: borra el autor del comentario o el dueño del post.
  const rows = unwrap(await db.from('comments').delete().eq('id', commentId).select('id'));
  if (rows.length === 0) throw notFound('Comentario');
}
