import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/core/queryClient';
import type { Me, StoryGroup } from '@/core/types';
import { Avatar } from '@/shared/ui/Avatar';
import { colors, spacing } from '@/shared/ui/theme';
import { isGroupSeen, useCreateStory, useStoryTray } from '../storiesHooks';

const SIZE = 64;
const UNSEEN_RING = '#E1306C'; // rosa Instagram: hay historias sin ver

function Bubble({
  label,
  avatarUrl,
  username,
  ring,
  onPress,
  badge,
}: {
  label: string;
  avatarUrl: string | null;
  username: string;
  ring: 'unseen' | 'seen' | 'none';
  onPress: () => void;
  badge?: React.ReactNode;
}) {
  const ringColor = ring === 'unseen' ? UNSEEN_RING : ring === 'seen' ? colors.border : 'transparent';
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', width: SIZE + 16, gap: 4 }} accessibilityLabel={`Historia de ${username}`}>
      <View style={{ padding: 2, borderRadius: (SIZE + 8) / 2, borderWidth: 2, borderColor: ringColor }}>
        <Avatar uri={avatarUrl} username={username} size={SIZE} />
        {badge}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text, maxWidth: SIZE + 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Fila horizontal de historias (encabezado del feed). */
export function StoryTray() {
  const { groups, seen } = useStoryTray();
  const createStory = useCreateStory();
  const me = useQueryClient().getQueryData<Me>(qk.me);

  const mine = groups.find((g) => g.is_me);
  const others = groups.filter((g) => !g.is_me);

  const addStory = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Activa el acceso a fotos en Ajustes.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [9, 16], // formato vertical de historia
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    createStory.mutate(result.assets[0].uri, {
      onError: (e) => Alert.alert('No se pudo publicar la historia', e.message),
    });
  };

  const open = (g: StoryGroup) => router.push(`/stories/${g.author.id}`);

  const addBadge = (
    <Pressable
      onPress={addStory}
      hitSlop={8}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.primary,
        borderWidth: 2,
        borderColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {createStory.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="add" size={14} color="#fff" />}
    </Pressable>
  );

  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={others}
      keyExtractor={(g) => g.author.id}
      contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.xs }}
      style={{ borderBottomWidth: 0.5, borderBottomColor: colors.border }}
      ListHeaderComponent={
        <Bubble
          label="Tu historia"
          avatarUrl={me?.avatar_url ?? null}
          username={me?.username ?? '?'}
          ring={mine ? (isGroupSeen(mine, seen) ? 'seen' : 'unseen') : 'none'}
          onPress={() => (mine ? open(mine) : void addStory())}
          badge={addBadge}
        />
      }
      renderItem={({ item }) => (
        <Bubble
          label={item.author.username}
          avatarUrl={item.author.avatar_url}
          username={item.author.username}
          ring={isGroupSeen(item, seen) ? 'seen' : 'unseen'}
          onPress={() => open(item)}
        />
      )}
    />
  );
}
