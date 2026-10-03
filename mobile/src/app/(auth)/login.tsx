import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { signIn } from '@/features/auth/authService';
import { Button, TextField } from '@/shared/ui/controls';
import { colors, spacing } from '@/shared/ui/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // No navegamos manualmente tras el login: AuthProvider detecta la sesión
  // y Stack.Protected muestra las pestañas.
  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg }}
    >
      <Text style={{ fontSize: 40, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xl, fontStyle: 'italic' }}>
        InstaClone
      </Text>
      <View style={{ gap: spacing.sm }}>
        <TextField placeholder="Correo electrónico" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextField placeholder="Contraseña" secureTextEntry value={password} onChangeText={setPassword} />
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Button title="Iniciar sesión" onPress={submit} loading={loading} disabled={!email || !password} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl, gap: 4 }}>
        <Text style={{ color: colors.muted }}>¿No tienes cuenta?</Text>
        <Link href="/register">
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Regístrate</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
