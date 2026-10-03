import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Comment } from '@/core/types';
import { useAddComment, useComments, useRealtimeComments } from '@/features/comments/commentsHooks';
import { Avatar } from '@/shared/ui/Avatar';
import { CenteredMessage } from '@/shared/ui/controls';
import { SyncStatusBanner } from '@/shared/ui/SyncStatusBanner';
import { colors, spacing } from '@/shared/ui/theme';

type Row = { comment: Comment; depth: 0 | 1 };

/**
 * Arma el hilo como Instagram: comentarios raíz y, debajo de cada uno, todas sus
 * respuestas (un solo nivel de sangría aunque se responda a una respuesta).
 * O(n): un Map de id -> raíz evita búsquedas anidadas.
 */
function buildThread(comments: Comment[]): Row[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: Comment): string => {
    let current = c;
    const seen = new Set<string>(); // protección ante ciclos en datos corruptos
    while (current.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parent_id)!;
    }
    return current.id;
  };

  const replies = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const c of comments) {
    if (!c.parent_id || !byId.has(c.parent_id)) roots.push(c);
    else {
      const root = rootOf(c);
      replies.set(root, [...(replies.get(root) ?? []), c]);
    }
  }
  return roots.flatMap((r) => [
    { comment: r, depth: 0 as const },
    ...(replies.get(r.id) ?? []).map((c) => ({ comment: c, depth: 1 as const })),
  ]);
}

function CommentRow({ row, onReply }: { row: Row; onReply: (c: Comment) => void }) {
  const { comment: c, depth } = row;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingRight: spacing.lg,
        paddingLeft: spacing.lg + depth * 44,
        opacity: c._status === 'pending' ? 0.55 : 1, // pendiente: se ve "fantasma" hasta confirmarse
      }}
    >
      <Avatar uri={c.user.avatar_url} username={c.user.username} size={depth ? 24 : 32} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text>
          <Text style={{ fontWeight: '600' }}>{c.user.username} </Text>
          {c.body}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          {c._status === 'pending' && <Text style={{ color: colors.muted, fontSize: 12 }}>Enviando…</Text>}
          {c._status === 'failed' && <Text style={{ color: colors.danger, fontSize: 12 }}>No se pudo enviar</Text>}
          {!c._status && (
            <>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString()}</Text>
              <Pressable onPress={() => onReply(c)} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>Responder</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const comments = useComments(postId);
  useRealtimeComments(postId);
  const addComment = useAddComment(postId);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const rows = useMemo(() => buildThread(comments.data ?? []), [comments.data]);

  const send = () => {
    addComment(text, replyTo?.id ?? null);
    setText('');
    setReplyTo(null);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <SyncStatusBanner />
      {comments.isPending ? (
        <CenteredMessage loading />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.comment.id}
          renderItem={({ item }) => <CommentRow row={item} onReply={setReplyTo} />}
          ListEmptyComponent={<CenteredMessage title="Aún no hay comentarios" subtitle="Sé el primero en comentar." />}
          contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : { paddingVertical: spacing.sm }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {replyTo && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.muted }}>Respondiendo a @{replyTo.user.username}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Text style={{ fontWeight: '600' }}>✕</Text>
          </Pressable>
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={replyTo ? `Responder a ${replyTo.user.username}…` : 'Agrega un comentario…'}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, paddingVertical: spacing.sm, fontSize: 15 }}
          multiline
          maxLength={1000}
        />
        <Pressable onPress={send} disabled={!text.trim()} hitSlop={8}>
          <Text style={{ color: colors.primary, fontWeight: '700', opacity: text.trim() ? 1 : 0.4 }}>Publicar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
