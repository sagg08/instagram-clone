import Constants from 'expo-constants';

/**
 * Configuración central. Las variables EXPO_PUBLIC_* se incrustan en el bundle
 * al compilar, por eso deben leerse con process.env.NOMBRE literal (no dinámico).
 */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Falta la variable ${name} en mobile/.env`);
  return value;
}

function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  // En desarrollo, Metro corre en tu laptop y Expo Go ya conoce su IP
  // (hostUri = "192.168.1.5:8081"). La reutilizamos para llegar al backend.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (__DEV__ && host) return `http://${host}:3000`;

  throw new Error('Falta EXPO_PUBLIC_API_URL en mobile/.env');
}

/** La URL de Supabase debe ser solo el origen: el SDK añade /auth/v1, /rest/v1, /storage/v1, etc. */
function supabaseOrigin(value: string): string {
  const url = new URL(value);
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(
      `EXPO_PUBLIC_SUPABASE_URL debe ser solo ${url.origin} (sin "${url.pathname}"). Corrígelo en mobile/.env`,
    );
  }
  return url.origin;
}

export const config = {
  apiUrl: resolveApiUrl(),
  supabaseUrl: supabaseOrigin(required(process.env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL')),
  supabaseAnonKey: required(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
} as const;
