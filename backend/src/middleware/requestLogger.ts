import type { RequestHandler } from 'express';

/**
 * Log de cada petición: método, ruta, status y duración.
 * Se escribe al TERMINAR la respuesta (evento 'finish'), cuando ya conocemos el status.
 * No registra query strings, headers ni cuerpos: ahí podría haber tokens o datos personales.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint(); // reloj monotónico: no lo afectan cambios de hora del sistema

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const icon = res.statusCode >= 500 ? '💥' : res.statusCode >= 400 ? '⚠️ ' : '✅';
    console.log(`${icon} ${req.method.padEnd(6)} ${req.baseUrl}${req.path} → ${res.statusCode} (${ms.toFixed(0)} ms)`);
  });

  next();
};
