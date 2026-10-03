import type { PostgrestError } from '@supabase/supabase-js';

/** Error de negocio con código HTTP y un código estable que la app puede interpretar. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') =>
  new HttpError(404, 'NOT_FOUND', `${what} no encontrado`);

/**
 * Traduce errores de Postgres/PostgREST a errores HTTP con sentido.
 * Códigos SQLSTATE: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function fromDbError(error: PostgrestError): HttpError {
  switch (error.code) {
    case '23505': // unique_violation
      return new HttpError(409, 'CONFLICT', 'El recurso ya existe');
    case '23503': // foreign_key_violation
      return new HttpError(404, 'NOT_FOUND', 'Un recurso relacionado no existe');
    case '23514': // check_violation
    case '22P02': // invalid_text_representation (ej. UUID mal formado)
      return new HttpError(400, 'INVALID_DATA', 'Datos inválidos');
    case '42501': // insufficient_privilege -> lo bloqueó una política RLS
      return new HttpError(403, 'FORBIDDEN', 'No tienes permiso para esta acción');
    case 'PGRST116': // .single() sin filas
      return notFound();
    default:
      // El detalle va al log del servidor, nunca al cliente (no filtrar internals).
      console.error('[db] error no mapeado', { code: error.code, message: error.message });
      return new HttpError(500, 'DB_ERROR', 'Error de base de datos');
  }
}

// Supabase devuelve una unión { data: X, error: null } | { data: null, error }.
// Tipar sobre el resultado completo (R) permite que TypeScript deduzca bien X.
type DbResult = { data: unknown; error: PostgrestError | null };

/** Devuelve data o lanza el error traducido. Si no hay datos, 404. */
export function unwrap<R extends DbResult>(result: R): NonNullable<R['data']> {
  if (result.error) throw fromDbError(result.error);
  if (result.data === null || result.data === undefined) throw notFound();
  return result.data as NonNullable<R['data']>;
}

/** Igual que unwrap, pero "no encontrado" es un resultado válido (para .maybeSingle()). */
export function unwrapMaybe<R extends DbResult>(result: R): NonNullable<R['data']> | null {
  if (result.error) throw fromDbError(result.error);
  return (result.data ?? null) as NonNullable<R['data']> | null;
}

/** Para operaciones sin datos de retorno (delete/upsert sin .select()): solo verifica el error. */
export function assertOk(result: { error: PostgrestError | null }): void {
  if (result.error) throw fromDbError(result.error);
}
