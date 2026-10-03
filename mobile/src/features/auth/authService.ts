import { supabase } from '@/core/supabase';

export const USERNAME_REGEX = /^[a-z0-9_.]{3,30}$/;

/**
 * Traduce errores de Supabase Auth a mensajes entendibles para el usuario.
 * En desarrollo (__DEV__) el error ORIGINAL se imprime en la terminal de Expo
 * para poder diagnosticar; en producción ese log no existe (no filtra internals).
 */
function friendly(error: { message: string; status?: number; code?: string }): string {
  if (__DEV__) console.warn('[auth] error de Supabase:', error.status, error.code, error.message);

  const m = error.message;
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
  if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene una cuenta';
  if (/database error saving new user/i.test(m)) return 'Ese nombre de usuario ya está en uso';
  if (/rate limit/i.test(m)) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.';
  if (/email.*invalid|invalid.*email|unable to validate email/i.test(m)) return 'Ese correo no es válido. Usa uno real (ej. tucorreo+a@gmail.com).';
  if (/not confirmed/i.test(m)) return 'Debes confirmar tu correo antes de entrar.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'El registro está deshabilitado en Supabase.';
  if (/fetch|network/i.test(m)) return 'No hay conexión con Supabase. Revisa tu internet y la URL en .env.';
  if (/password/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
  return 'No se pudo completar la operación. Intenta de nuevo.';
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendly(error));
}

export async function signUp(input: { email: string; password: string; username: string; fullName: string }) {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_REGEX.test(username)) {
    throw new Error('Usuario: 3-30 caracteres, solo minúsculas, números, "_" y "."');
  }
  // username y full_name viajan como metadata: el trigger handle_new_user crea el perfil con ellos.
  const { error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { username, full_name: input.fullName.trim() || null } },
  });
  if (error) throw new Error(friendly(error));
}

export async function signOut() {
  await supabase.auth.signOut();
}
