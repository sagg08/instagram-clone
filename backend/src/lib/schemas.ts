import { z } from 'zod';

// Esquemas reutilizables (DRY). Toda entrada externa se valida antes de tocar la base de datos.
export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });

/** Cursor de paginación: (created_at, id) del último elemento recibido. */
export const cursorQuery = z.object({
  cursor_created_at: z.string().datetime({ offset: true }).optional(),
  cursor_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type Cursor = { created_at: string; id: string } | null;

/** Calcula el cursor siguiente: si la página vino llena, puede haber más. */
export function nextCursor<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): Cursor {
  const last = rows.at(-1);
  return rows.length === limit && last ? { created_at: last.created_at, id: last.id } : null;
}
