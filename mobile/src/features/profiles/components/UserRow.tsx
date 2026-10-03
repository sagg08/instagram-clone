import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { UserMini } from '@/core/types';
import { Avatar } from '@/shared/ui/Avatar';
import { colors, spacing } from '@/shared/ui/theme';

/** Fila de usuario reutilizable (búsqueda, solicitudes, seguidores). `right` permite añadir botones. */
export function UserRow({ user, right }: { user: UserMini; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
      <Link href={`/user/${user.username}`} asChild>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
          <Avatar uri={user.avatar_url} username={user.username} size={44} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontWeight: '600' }}>{user.username}</Text>
            {user.full_name ? <Text style={{ color: colors.muted }}>{user.full_name}</Text> : null}
          </View>
        </Pressable>
      </Link>
      {right}
    </View>
  );
}
