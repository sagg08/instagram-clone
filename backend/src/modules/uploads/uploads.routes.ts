import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { HttpError } from '../../lib/errors.js';

/**
 * Subida de imágenes con "signed upload URL".
 *
 * Flujo: 1) la app pide aquí una URL firmada  2) sube el archivo DIRECTO a Storage
 *        3) crea el post enviando solo el path.
 *
 * ¿Por qué no pasar la imagen por Express? Porque el backend no gasta RAM ni ancho
 * de banda reenviando megas, y Storage aplica sus límites (5 MB, solo jpeg/png/webp).
 * El servidor genera el nombre: el cliente no controla la ruta (evita sobrescribir
 * archivos ajenos o path traversal).
 */
export const uploadsRouter = Router();

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

const signBody = z.object({
  bucket: z.enum(['posts', 'stories', 'avatars']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

uploadsRouter.post('/uploads/sign', async (req, res) => {
  const { db, userId } = getAuth(req);
  const { bucket, content_type } = signBody.parse(req.body);

  // La carpeta = id del usuario: así lo exige la política "storage: subir propio".
  const path = `${userId}/${randomUUID()}.${EXTENSIONS[content_type]}`;
  const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    console.error('[storage] no se pudo firmar la subida', error?.message);
    throw new HttpError(502, 'STORAGE_ERROR', 'No se pudo preparar la subida');
  }

  res.status(201).json({ bucket, path: data.path, signed_url: data.signedUrl, token: data.token });
});
