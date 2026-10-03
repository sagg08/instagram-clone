import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No existe ${req.method} ${req.path}` } });
};

/**
 * Manejador central de errores. Express 5 captura automáticamente los errores
 * lanzados en handlers async, así que ningún controlador necesita try/catch.
 * Formato único de error: { error: { code, message, details? } }
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.flatten().fieldErrors },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // JSON mal formado en el body
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido' } });
    return;
  }

  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Cuerpo demasiado grande' } });
    return;
  }

  // Inesperado: se registra completo en el servidor, al cliente solo un mensaje genérico.
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
};
