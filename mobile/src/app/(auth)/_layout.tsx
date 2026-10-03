import { Stack } from 'expo-router';

// Sin sesión, la primera pantalla visible es el login.
export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
