import { config } from '../config';
import { supabase } from '../supabase';

/** Error tipado de la API: la UI y la cola offline deciden qué hacer según status/code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number, // 0 = no hubo respuesta (sin red / timeout)
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }

  /** ¿Vale la pena reintentar? Sí si es un problema de red o del servidor, no si la petición era inválida. */
  get isRetryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type Query = Record<string, string | number | null | undefined>;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal; // React Query lo pasa para cancelar peticiones obsoletas
  timeoutMs?: number;
};

/**
 * Único punto de salida hacia el backend:
 *  - adjunta el JWT vigente (getSession lo refresca si expiró)
 *  - aplica timeout (fetch no tiene uno por defecto: podría colgarse indefinidamente)
 *  - convierte cualquier fallo en ApiError
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, timeoutMs = 15_000 } = options;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const url = new URL(`${config.apiUrl}/api${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  // Un solo AbortController combina el timeout y la cancelación externa.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const aborted = signal?.aborted;
    throw new ApiError(0, aborted ? 'ABORTED' : 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (response.status === 204) return undefined as T;

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      json?.error?.code ?? 'HTTP_ERROR',
      json?.error?.message ?? `Error ${response.status}`,
    );
  }
  return json as T;
}
