import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrap, unwrapMaybe, notFound, HttpError } from '../../lib/errors.js';
import { avatarUrl } from '../../lib/storage.js';

const PROFILE_COLUMNS = 'id, username, full_name, bio, avatar_path, is_private, created_at';
const MINI_PROFILE = 'id, username, full_name, avatar_path';

type MiniProfile = { id: string; username: string; full_name: string | null; avatar_path: string | null };

export type FollowState = 'none' | 'pending' | 'accepted';

/** Agrega avatar_url a cualquier objeto con avatar_path (la app nunca arma URLs). */
export function withAvatar<T extends { avatar_path: string | null }>(db: SupabaseClient, p: T) {
  return { ...p, avatar_url: avatarUrl(db, p.avatar_path) };
}

export async function getMe(db: SupabaseClient, userId: string) {
  const me = unwrap(await db.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single());
  return withAvatar(db, me);
}

export type ProfilePatch = Partial<{
  username: string;
  full_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  is_private: boolean;
}>;

export async function updateMe(db: SupabaseClient, userId: string, patch: ProfilePatch) {
  // Solo puede apuntar a un avatar dentro de SU carpeta en Storage.
  if (patch.avatar_path && !patch.avatar_path.startsWith(`${userId}/`)) {
    throw new HttpError(403, 'FORBIDDEN', 'Ruta de avatar no permitida');
  }
  const me = unwrap(
    await db.from('profiles').update(patch).eq('id', userId).select(PROFILE_COLUMNS).single(),
  );
  return withAvatar(db, me);
}

export async function searchUsers(db: SupabaseClient, q: string) {
  // "_" es comodín en LIKE: lo escapamos para que se busque literal.
  const pattern = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = unwrap(
    await db.from('profiles').select(`${MINI_PROFILE}, is_private`).ilike('username', pattern).limit(20),
  );
  return rows.map((r) => withAvatar(db, r));
}

/** ¿El usuario actual puede ver el contenido de ownerId? Reutiliza LA MISMA regla SQL del RLS. */
export async function canViewContent(db: SupabaseClient, ownerId: string): Promise<boolean> {
  return unwrap(await db.rpc('can_view_content', { owner: ownerId })) === true;
}

export async function getProfile(db: SupabaseClient, viewerId: string, username: string) {
  const profile = unwrapMaybe(
    await db.from('profiles').select(PROFILE_COLUMNS).eq('username', username).maybeSingle(),
  );
  if (!profile) throw notFound('Perfil');

  // Las 3 consultas son independientes: se ejecutan en paralelo.
  const [stats, relation, canView] = await Promise.all([
    db.rpc('get_profile_stats', { p_user_id: profile.id }).single(),
    db
      .from('follows')
      .select('status')
      .eq('follower_id', viewerId)
      .eq('following_id', profile.id)
      .maybeSingle(),
    canViewContent(db, profile.id),
  ]);

  return {
    ...withAvatar(db, profile),
    stats: unwrap(stats),
    is_me: profile.id === viewerId,
    follow_state: ((unwrapMaybe(relation)?.status as FollowState | undefined) ?? 'none') as FollowState,
    can_view_content: canView,
  };
}

/** Listas de seguidores / seguidos: protegidas igual que el contenido. */
export async function listConnections(
  db: SupabaseClient,
  userId: string,
  kind: 'followers' | 'following',
) {
  if (!(await canViewContent(db, userId))) {
    throw new HttpError(403, 'PRIVATE_ACCOUNT', 'Esta cuenta es privada');
  }

  // follower:profiles!follows_follower_id_fkey(...) = JOIN usando esa FK concreta
  // (follows tiene DOS FK hacia profiles, por eso hay que decir cuál).
  const isFollowers = kind === 'followers';
  const select = isFollowers
    ? `created_at, user:profiles!follows_follower_id_fkey(${MINI_PROFILE})`
    : `created_at, user:profiles!follows_following_id_fkey(${MINI_PROFILE})`;

  const rows = unwrap(
    await db
      .from('follows')
      .select(select)
      .eq(isFollowers ? 'following_id' : 'follower_id', userId)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })
      .limit(100),
  ) as unknown as { created_at: string; user: MiniProfile }[];

  return rows.map((r) => withAvatar(db, r.user));
}
