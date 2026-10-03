import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, spacing } from './theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, compact }: ButtonProps) {
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: primary ? colors.primary : colors.surface,
        paddingVertical: compact ? 7 : 12,
        paddingHorizontal: spacing.lg,
        borderRadius: 8,
        alignItems: 'center',
        opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        flexGrow: compact ? 1 : undefined,
      })}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : colors.text} />
      ) : (
        <Text style={{ color: primary ? '#fff' : colors.text, fontWeight: '600', fontSize: 14 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[
        {
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: '#FAFAFA',
          borderRadius: 6,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
          fontSize: 14,
          color: colors.text,
        },
        props.style,
      ]}
    />
  );
}

/** Estado vacío / error / carga a pantalla completa. */
export function CenteredMessage({ title, subtitle, loading }: { title?: string; subtitle?: string; loading?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm }}>
      {loading && <ActivityIndicator />}
      {title && <Text style={{ fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Text>}
      {subtitle && <Text style={{ color: colors.muted, textAlign: 'center' }}>{subtitle}</Text>}
    </View>
  );
}
