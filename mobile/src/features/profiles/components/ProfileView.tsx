import { Alert, Pressable, Switch, Text, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { openConversationWith } from '@/features/messages/messagesHooks';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { ApiError } from '@/core/api/client';
import type { Profile } from '@/core/types';
import { Avatar } from '@/shared/ui/Avatar';
import { RemoteImage } from '@/shared/ui/RemoteImage';
import { Button, CenteredMessage } from '@/shared/ui/controls';
import { colors, spacing } from '@/shared/ui/theme';
import { useUserPosts } from '@/features/posts/postsHooks';
import { useProfile, useToggleFollow, useUpdateMe } from '../profilesHooks';
import { CacheStatsPanel } from '@/shared/ui/CacheStatsPanel';

const FOLLOW_LABEL = { none: 'Seguir', pending: 'Solicitado', accepted: 'Siguiendo' } as const;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontWeight: '700', fontSize: 16 }}>{value}</Text>
      <Text style={{ fontSize: 13 }}>{label}</Text>
    </View>
  );
}

function Header({ profile }: { profile: Profile }) {
  const toggleFollow = useToggleFollow(profile);
  const updateMe = useUpdateMe();

  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar uri={profile.avatar_url} username={profile.username} size={80} />
        <Stat value={profile.stats.posts_count} label="publicaciones" />
        <Stat value={profile.stats.followers_count} label="seguidores" />
        <Stat value={profile.stats.following_count} label="seguidos" />
      </View>

      <View>
        {profile.full_name ? <Text style={{ fontWeight: '600' }}>{profile.full_name}</Text> : null}
        {profile.bio ? <Text>{profile.bio}</Text> : null}
      </View>

      {profile.is_me && __DEV__ && <CacheStatsPanel />}

      {profile.is_me ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text>Cuenta privada</Text>
          <Switch
            value={profile.is_private}
            disabled={updateMe.isPending}
            onValueChange={(is_private) => updateMe.mutate({ is_private })}
          />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            compact
            title={FOLLOW_LABEL[profile.follow_state]}
            variant={profile.follow_state === 'none' ? 'primary' : 'secondary'}
            loading={toggleFollow.isPending}
            onPress={() => toggleFollow.mutate()}
          />
          <Button
            compact
            title="Mensaje"
            variant="secondary"
            onPress={() => {
              openConversationWith(profile.id)
                .then(({ id }) => router.push(`/chat/${id}`))
                .catch((e) => Alert.alert('No se pudo abrir el chat', (e as Error).message));
            }}
          />
        </View>
      )}
    </View>
  );
}

/** Perfil reutilizable: lo usan la pestaña "Perfil" (el mío) y user/[username] (el de otros). */
export function ProfileView({ username }: { username: string }) {
  const { width } = useWindowDimensions();
  const profileQuery = useProfile(username);
  const profile = profileQuery.data;
  const posts = useUserPosts(profile?.id, Boolean(profile?.can_view_content));

  if (profileQuery.isPending) return <CenteredMessage loading />;
  if (profileQuery.error) {
    const notFound = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;
    return <CenteredMessage title={notFound ? 'Este usuario no existe' : 'No se pudo cargar el perfil'} />;
  }
  if (!profile) return null;

  const tile = width / 3;
  const items = posts.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <FlashList
      data={profile.can_view_content ? items : []}
      keyExtractor={(item) => item.id}
      numColumns={3}
      ListHeaderComponent={<Header profile={profile} />}
      ListEmptyComponent={
        !profile.can_view_content ? (
          <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
            <Ionicons name="lock-closed-outline" size={48} />
            <Text style={{ fontWeight: '600' }}>Esta cuenta es privada</Text>
            <Text style={{ color: colors.muted }}>Síguela para ver sus fotos.</Text>
          </View>
        ) : posts.isPending ? null : (
          <CenteredMessage title="Aún no hay publicaciones" />
        )
      }
      renderItem={({ item }) => (
        <Link href={`/post/${item.id}`} asChild>
          <Pressable style={{ width: tile, height: tile, padding: 1 }}>
            <RemoteImage cacheKey={item.image_path} uri={item.image_url} width={tile - 2} height={tile - 2} />
          </Pressable>
        </Link>
      )}
      onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && posts.fetchNextPage()}
      onEndReachedThreshold={0.5}
      refreshing={profileQuery.isRefetching}
      onRefresh={() => {
        profileQuery.refetch();
        posts.refetch();
      }}
    />
  );
}
