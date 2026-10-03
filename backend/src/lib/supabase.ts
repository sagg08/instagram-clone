import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// El backend es stateless: no guarda sesión ni refresca tokens (eso lo hace la app).
const serverOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/** Cliente sin usuario: solo se usa para VALIDAR tokens en el middleware de auth. */
export const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, serverOptions);

/**
 * Cliente "en nombre del usuario": reenvía su JWT a Supabase.
 * Así Postgres sabe quién es (auth.uid()) y aplica TODAS las políticas RLS.
 * Resultado: aunque la API tuviera un bug de autorización, la base de datos
 * seguiría bloqueando el acceso indebido (defensa en profundidad).
 */
export function clientForUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...serverOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
