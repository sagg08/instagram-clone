import { FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { session } from '@/core/session';
import type { InboxItem } from '@/core/types';
import { useInbox } from '@/features/messages/messagesHooks';
import { Avatar } from '@/shared/ui/Avatar';
import { CenteredMessage } from '@/shared/ui/controls';
import { SyncStatusBanner } from '@/shared/ui/SyncStatusBanner';
import { colors, spacing } from '@/shared/ui/theme';

/** "hace 5 min", "ayer"... formato corto como en Instagram. */
function shortTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString();
}

function InboxRow({ item }: { item: InboxItem }) {
  const unread = item.unread_count > 0;
  const mine = item.last_message?.sender_id === session.userId;
  const preview = item.last_message
    ? `${mine ? 'Tú: ' : ''}${item.last_message.body}`
    : 'Nueva conversación';

  return (
    <Link href={`/chat/${item.id}`} asChild>
      <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        <Avatar uri={item.other.avatar_url} username={item.other.username} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: unread ? '700' : '500' }}>{item.other.username}</Text>
          <Text numberOfLines={1} style={{ color: unread ? colors.text : colors.muted, fontWeight: unread ? '600' : '400' }}>
            {preview} · {shortTime(item.last_message_at)}
          </Text>
        </View>
        {unread && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary }} />}
      </Pressable>
    </Link>
  );
}

/**
 * Bandeja de mensajes. El ORDEN lo decide el servidor (last_message_at, que actualiza
 * un trigger en cada mensaje). Cuando llega un mensaje, el listener Realtime global
 * invalida esta consulta y la conversación sube sola al primer lugar.
 */
export default function InboxScreen() {
  const inbox = useInbox();
  if (inbox.isPending) return <CenteredMessage loading />;

  return (
    <FlatList
      data={inbox.data ?? []}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <InboxRow item={item} />}
      refreshing={inbox.isRefetching}
      onRefresh={() => inbox.refetch()}
      ListHeaderComponent={<SyncStatusBanner />}
      ListEmptyComponent={
        <CenteredMessage title="Sin mensajes" subtitle="Abre el perfil de alguien y toca «Mensaje» para empezar." />
      }
      contentContainerStyle={(inbox.data?.length ?? 0) === 0 ? { flexGrow: 1 } : undefined}
    />
  );
}
