import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { env, isProduction } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { profilesRouter } from './modules/profiles/profiles.routes.js';
import { followsRouter } from './modules/follows/follows.routes.js';
import { postsRouter } from './modules/posts/posts.routes.js';
import { commentsRouter } from './modules/comments/comments.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { messagesRouter } from './modules/messages/messages.routes.js';
import { storiesRouter } from './modules/stories/stories.routes.js';

export function createApp() {
  const app = express();

  // En Render/otros PaaS hay un proxy delante: sin esto el rate limit vería
  // la IP del proxy y bloquearía a todos los usuarios a la vez.
  if (isProduction) app.set('trust proxy', 1);

  app.use(requestLogger); // primero, para medir también las peticiones que fallen después
  app.use(helmet()); // headers de seguridad (oculta X-Powered-By, nosniff, etc.)

  // CORS solo aplica a navegadores; la app móvil no lo necesita.
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length > 0 ? origins : false }));

  // Las imágenes NO pasan por la API (van directo a Storage), así que 100 kB
  // basta y limita el abuso con cuerpos gigantes.
  app.use(express.json({ limit: '100kb' }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300, // por IP y minuto: holgado para scroll + cola offline vaciándose
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // Pública: para que Render y tú verifiquen que el servidor está vivo.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Todo lo que está bajo /api exige usuario autenticado.
  const api = Router();
  api.use(requireAuth);
  api.use(profilesRouter);
  api.use(followsRouter);
  api.use(postsRouter);
  api.use(commentsRouter);
  api.use(uploadsRouter);
  api.use(messagesRouter);
  api.use(storiesRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
