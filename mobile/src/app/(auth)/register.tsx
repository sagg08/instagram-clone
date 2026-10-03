import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { signUp } from '@/features/auth/authService';
import { Button, TextField } from '@/shared/ui/controls';
import { colors, spacing } from '@/shared/ui/theme';

export default function RegisterScreen() {
  const [form, setForm] = useState({ email: '', password: '', username: '', fullName: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      // Con "Confirm email" desactivado, signUp ya devuelve sesión y entramos directo.
      await signUp(form);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const incomplete = !form.email || form.password.length < 6 || !form.username;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg }}
    >
      <Text style={{ fontSize: 32, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xl, fontStyle: 'italic' }}>
        Crea tu cuenta
      </Text>
      <View style={{ gap: spacing.sm }}>
        <TextField placeholder="Correo electrónico" keyboardType="email-address" value={form.email} onChangeText={set('email')} />
        <TextField placeholder="Nombre completo" autoCapitalize="words" value={form.fullName} onChangeText={set('fullName')} />
        <TextField placeholder="Nombre de usuario" value={form.username} onChangeText={set('username')} maxLength={30} />
        <TextField placeholder="Contraseña (mín. 6)" secureTextEntry value={form.password} onChangeText={set('password')} />
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Button title="Registrarte" onPress={submit} loading={loading} disabled={incomplete} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl, gap: 4 }}>
        <Text style={{ color: colors.muted }}>¿Ya tienes cuenta?</Text>
        <Link href="/login" dismissTo>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Inicia sesión</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
