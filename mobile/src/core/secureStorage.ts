import * as SecureStore from 'expo-secure-store';

/**
 * Almacenamiento de la sesión en SecureStore (Keychain en iOS / Keystore en Android),
 * cifrado por el sistema operativo. AsyncStorage guardaría los tokens en texto plano.
 *
 * Problema: SecureStore recomienda valores ≤ 2048 bytes y la sesión de Supabase
 * (access token + refresh token + datos del usuario) suele superarlo.
 * Solución: partimos el valor en trozos y guardamos cuántos hay.
 */
const CHUNK_SIZE = 1800;

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function getItem(key: string): Promise<string | null> {
  const count = Number(await SecureStore.getItemAsync(countKey(key)));
  if (!count) return null;

  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))),
  );
  // Si falta un trozo, la sesión está corrupta: mejor tratarla como inexistente.
  return parts.some((p) => p === null) ? null : parts.join('');
}

async function removeItem(key: string): Promise<void> {
  const count = Number(await SecureStore.getItemAsync(countKey(key)));
  await Promise.all(
    Array.from({ length: count || 0 }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))),
  );
  await SecureStore.deleteItemAsync(countKey(key));
}

async function setItem(key: string, value: string): Promise<void> {
  await removeItem(key); // evita trozos huérfanos de una sesión anterior más larga
  const chunks = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [''];
  await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(chunkKey(key, i), c)));
  // El contador se escribe al FINAL: si la app muere a mitad, no queda una sesión a medias.
  await SecureStore.setItemAsync(countKey(key), String(chunks.length));
}

export const secureStorage = { getItem, setItem, removeItem };
