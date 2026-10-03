import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrap, unwrapMaybe, assertOk, notFound, HttpError } from '../../lib/errors.js';
import { withAvatar, type FollowState } from '../profiles/profiles.service.js';

/**
 * Seguir a alguien. NO enviamos el status: lo decide el trigger set_follow_status
 * en Postgres (privada -> pending, pública -> accepted). El cliente no puede forzarlo.
 * Idempotente: si ya existía la relación, devuelve el estado actual.
 */
export async function follow(db: SupabaseClient, me: string, targetId: string) {
  if (me === targetId) throw new HttpError(400, 'SELF_FOLLOW', 'No puedes seguirte a ti mismo');

  const { data, error } = await db
    .from('follows')
    .insert({ follower_id: me, following_id: targetId })
    .select('status')
    .single();

  if (error?.code === '23505') {
    // Ya existía (doble tap o reintento de la cola offline): no es un error.
    const existing = unwrap(
      await db.from('follows').select('status').eq('follower_id', me).eq('following_id', targetId).single(),
    );
    return { follow_state: existing.status as FollowState };
  }
  return { follow_state: unwrap({ data, error }).status as FollowState };
}

/** Dejar de seguir o cancelar una solicitud pendiente. Idempotente. */
export async function unfollow(db: SupabaseClient, me: string, targetId: string) {
  assertOk(await db.from('follows').delete().eq('follower_id', me).eq('following_id', targetId));
  return { follow_state: 'none' as FollowState };
}

/** Solicitudes que OTROS me han enviado (pestaña Actividad). */
export async function listIncomingRequests(db: SupabaseClient, me: string) {
  const rows = unwrap(
    await db
      .from('follows')
      .select('created_at, user:profiles!follows_follower_id_fkey(id, username, full_name, avatar_path)')
      .eq('following_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ) as unknown as {
    created_at: string;
    user: { id: string; username: string; full_name: string | null; avatar_path: string | null };
  }[];

  return rows.map((r) => ({ requested_at: r.created_at, user: withAvatar(db, r.user) }));
}

/** Aprobar: el RLS solo permite pending -> accepted y solo al dueño de la cuenta. */
export async function acceptRequest(db: SupabaseClient, me: string, followerId: string) {
  const row = unwrapMaybe(
    await db
      .from('follows')
      .update({ status: 'accepted' })
      .eq('follower_id', followerId)
      .eq('following_id', me)
      .eq('status', 'pending')
      .select('status')
      .maybeSingle(),
  );
  if (!row) throw notFound('Solicitud');
  return { follow_state: 'accepted' as FollowState };
}

/** Rechazar = borrar la fila pendiente (la persona puede volver a solicitar después). */
export async function rejectRequest(db: SupabaseClient, me: string, followerId: string) {
  const rows = unwrap(
    await db
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', me)
      .eq('status', 'pending')
      .select('follower_id'),
  );
  if (rows.length === 0) throw notFound('Solicitud');
  return { follow_state: 'none' as FollowState };
}
