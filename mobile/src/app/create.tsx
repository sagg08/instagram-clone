import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCreatePost } from '@/features/posts/postsHooks';
import { Button, TextField } from '@/shared/ui/controls';
import { colors, spacing } from '@/shared/ui/theme';

/** Modal de nueva publicación: elegir foto -> pie de foto -> publicar. */
export default function CreatePostScreen() {
  const { width } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const createPost = useCreatePost();

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Activa el acceso a fotos en Ajustes para publicar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1], // recorte cuadrado como Instagram
      quality: 1, // la compresión la hacemos nosotros con un tamaño controlado
    });
    if (!result.canceled && result.assets[0]) setUri(result.assets[0].uri);
  };

  const publish = () => {
    if (!uri) return;
    createPost.mutate(
      { uri, caption },
      {
        onSuccess: () => router.back(),
        onError: (e) => Alert.alert('No se pudo publicar', e.message),
      },
    );
  };

  const size = width - spacing.lg * 2;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={pickImage}
          style={{ width: size, height: size, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
        >
          {uri ? (
            <Image source={{ uri }} style={{ width: size, height: size }} />
          ) : (
            <>
              <Ionicons name="image-outline" size={48} color={colors.muted} />
              <Text style={{ color: colors.muted }}>Toca para elegir una foto</Text>
            </>
          )}
        </Pressable>
        <TextField
          placeholder="Escribe un pie de foto..."
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={2200}
          autoCapitalize="sentences"
          autoCorrect
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
        <Button title="Compartir" onPress={publish} loading={createPost.isPending} disabled={!uri} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
