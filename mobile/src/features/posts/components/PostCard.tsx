import { memo, useRef } from 'react';
import { Pressable, Share, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import type { Post } from '@/core/types';
import { Avatar } from '@/shared/ui/Avatar';
import { RemoteImage } from '@/shared/ui/RemoteImage';
import { colors, spacing } from '@/shared/ui/theme';
import { useSetLike } from '../postsHooks';

/**
 * Celda del feed. Está envuelta en memo(): si el post no cambió, React no la
 * vuelve a renderizar al hacer scroll o al cambiar otra celda (clave para los 60 FPS).
 */
export const PostCard = memo(function PostCard({ post }: { post: Post }) {
  const { width } = useWindowDimensions();
  const setLike = useSetLike();

  const lastTap = useRef(0);

  const toggleLike = () => setLike(post.id, !post.liked_by_me);

  // Doble tap: dos toques en menos de 300 ms. Solo DA like (nunca lo quita), igual que Instagram.
  const onImagePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 300 && !post.liked_by_me) {
      setLike(post.id, true);
    }
    lastTap.current = now;
  };

  // "Compartir referencia interna": deep link que abre este post dentro de la app.
  // En Expo Go genera exp://...; en un build propio genera instagramclone://post/{id}.
  const share = () => Share.share({ message: Linking.createURL(`post/${post.id}`) });

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Link href={`/user/${post.author.username}`} asChild>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
          <Avatar uri={post.author.avatar_url} username={post.author.username} />
          <Text style={{ fontWeight: '600' }}>{post.author.username}</Text>
        </Pressable>
      </Link>

      {/* Doble tap = like, como en Instagram */}
      <Pressable onPress={onImagePress}>
        <RemoteImage cacheKey={post.image_path} uri={post.image_url} width={width} height={width} />
      </Pressable>

      <View style={{ flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <Pressable onPress={toggleLike} hitSlop={8} accessibilityLabel={post.liked_by_me ? 'Quitar me gusta' : 'Me gusta'}>
          <Ionicons
            name={post.liked_by_me ? 'heart' : 'heart-outline'}
            size={26}
            color={post.liked_by_me ? colors.like : colors.text}
          />
        </Pressable>
        <Link href={`/comments/${post.id}`} asChild>
          <Pressable hitSlop={8} accessibilityLabel="Comentarios">
            <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          </Pressable>
        </Link>
        <Pressable onPress={share} hitSlop={8} accessibilityLabel="Compartir">
          <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 4 }}>
        <Text style={{ fontWeight: '600' }}>
          {post.like_count} Me gusta
        </Text>
        {post.caption ? (
          <Text>
            <Text style={{ fontWeight: '600' }}>{post.author.username} </Text>
            {post.caption}
          </Text>
        ) : null}
        {post.comment_count > 0 && (
          <Link href={`/comments/${post.id}`}>
            <Text style={{ color: colors.muted }}>Ver los {post.comment_count} comentarios</Text>
          </Link>
        )}
        <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(post.created_at).toLocaleDateString()}</Text>
      </View>
    </View>
  );
});
