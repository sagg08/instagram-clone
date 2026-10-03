import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { session } from '@/core/session';
import type { Message } from '@/core/types';
import {
  useConversation,
  useMarkReadWhileOpen,
  useMessages,
  useSendMessage,
  useTyping,
} from '@/features/messages/messagesHooks';
import { CenteredMessage } from '@/shared/ui/controls';
import { SyncStatusBanner } from '@/shared/ui/SyncStatusBanner';
import { colors, spacing } from '@/shared/ui/theme';

/** Estado del mensaje que se muestra bajo MI último mensaje (como Instagram). */
function statusLabel(m: Message) {
  if (m._status === 'pending') return 'Enviando…';
  if (m._status === 'failed') return 'No se pudo enviar';
  if (m.read_at) return 'Visto';
  if (m.delivered_at) return 'Entregado';
  return 'Enviado';
}

function Bubble({ m, mine, showStatus }: { m: Message; mine: boolean; showStatus: boolean }) {
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', paddingHorizontal: spacing.md, marginVertical: 2 }}>
      <View
        style={{
          maxWidth: '78%',
          backgroundColor: mine ? colors.primary : colors.surface,
          borderRadius: 20,
          paddingHorizontal: 14,
          paddingVertical: 9,
          opacity: m._status === 'pending' ? 0.6 : 1,
        }}
      >
        <Text style={{ color: mine ? '#fff' : colors.text, fontSize: 15 }}>{m.body}</Text>
      </View>
      {showStatus && (
        <Text style={{ fontSize: 11, color: m._status === 'failed' ? colors.danger : colors.muted, marginTop: 2 }}>
          {statusLabel(m)}
        </Text>
      )}
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = session.userId;

  const conversation = useConversation(id);
  const messages = useMessages(id);
  const send = useSendMessage(id);
  const typing = useTyping(id);
  useMarkReadWhileOpen(id);

  const [text, setText] = useState('');
  const items = useMemo(() => messages.data?.pages.flatMap((p) => p.items) ?? [], [messages.data]);

  // El "Visto/Entregado" va solo bajo MI mensaje más reciente.
  const lastMineId = items.find((m) => m.sender_id === me)?.id;

  // Si llega un mensaje del otro, ya no está escribiendo.
  const newestId = items[0]?.id;
  const newestFromOther = items[0] && items[0].sender_id !== me;
  useEffect(() => {
    if (newestFromOther) typing.clearOtherTyping();
  }, [newestId, newestFromOther, typing.clearOtherTyping]);

  const submit = () => {
    send(text);
    setText('');
    typing.stopTyping();
  };

  return (
    <>
      <Stack.Screen options={{ title: conversation.data?.other.username ?? '' }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <SyncStatusBanner />
        {messages.isPending ? (
          <CenteredMessage loading />
        ) : (
          // INVERTIDA: el índice 0 queda abajo. Así el chat abre en el mensaje más
          // reciente sin hacer scroll, y al cargar mensajes viejos no "salta" la vista.
          <FlatList
            inverted
            data={items}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <Bubble m={item} mine={item.sender_id === me} showStatus={item.id === lastMineId} />
            )}
            onEndReached={() => messages.hasNextPage && !messages.isFetchingNextPage && messages.fetchNextPage()}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingVertical: spacing.sm }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              typing.otherTyping ? (
                <Text style={{ color: colors.muted, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, fontStyle: 'italic' }}>
                  Escribiendo…
                </Text>
              ) : null
            }
          />
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            margin: spacing.md,
            marginBottom: Math.max(insets.bottom, spacing.md),
            paddingHorizontal: spacing.lg,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 24,
          }}
        >
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              typing.onTextChange(t);
            }}
            onBlur={typing.stopTyping}
            placeholder="Mensaje…"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, paddingVertical: 10, fontSize: 15, maxHeight: 120 }}
            multiline
            maxLength={2000}
          />
          <Pressable onPress={submit} disabled={!text.trim()} hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: '700', opacity: text.trim() ? 1 : 0.4 }}>Enviar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
