import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { anonClient, clientForUser } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

/**
 * Caché de tokens YA validados.
 *
 * Problema: validar el JWT con auth.getUser() es un viaje de red a Supabase
 * (~150-400 ms) y se repetía en CADA petición con el mismo token.
 * Solución: recordar por 60 s que ese token es válido y de qué usuario es.
 *
 * Trade-off (decisión consciente): si un usuario cierra sesión o se le revoca
 * el acceso, su token puede seguir funcionando hasta 60 s más. A cambio, casi
 * todas las peticiones se ahorran un viaje de red. 60 s es mucho menor que la
 * vida del JWT (1 h por defecto), así que el riesgo agregado es pequeño.
 *
 * - La clave es el SHA-256 del token, no el token en sí (no dejamos credenciales
 *   legibles en la memoria del proceso más tiempo del necesario).
 * - Tamaño acotado: un atacante enviando tokens distintos no puede llenar la RAM.
 * - Nunca se cachea un token inválido.
 */
const TOKEN_TTL_MS = 60_000;
const MAX_CACHED_TOKENS = 1_000;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Momento de expiración del JWT (claim "exp"), sin verificarlo: solo para no cachear más allá de su vida. */
function jwtExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function getCachedUser(key: string): string | null {
  const hit = tokenCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    tokenCache.delete(key);
    return null;
  }
  return hit.userId;
}

function cacheUser(key: string, userId: string, token: string) {
  const expiresAt = Math.min(Date.now() + TOKEN_TTL_MS, jwtExpiryMs(token));
  if (expiresAt <= Date.now()) return;
  if (tokenCache.size >= MAX_CACHED_TOKENS) {
    // Map conserva el orden de inserción: el primero es el más antiguo.
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }
  tokenCache.set(key, { userId, expiresAt });
}

/**
 * Autenticación: exige "Authorization: Bearer <jwt>" emitido por Supabase Auth.
 * La primera vez valida contra Supabase (detecta tokens revocados/expirados);
 * las siguientes, durante 60 s, responde desde la caché.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Falta el token de acceso');
  }
  const token = header.slice('Bearer '.length).trim();
  const key = hashToken(token);

  let userId = getCachedUser(key);
  if (!userId) {
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data.user) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Token inválido o expirado');
    }
    userId = data.user.id;
    cacheUser(key, userId, token);
  }

  // Aunque la identidad venga de la caché, el JWT se sigue reenviando a Supabase:
  // las políticas RLS se aplican igual en cada consulta.
  req.auth = { userId, db: clientForUser(token) };
  next();
};

/** Acceso tipado al contexto de auth dentro de los handlers protegidos. */
export function getAuth(req: Request) {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'No autenticado');
  return req.auth;
}
