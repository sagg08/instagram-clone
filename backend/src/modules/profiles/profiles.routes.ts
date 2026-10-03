import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { idParam } from '../../lib/schemas.js';
import * as service from './profiles.service.js';

// Capa HTTP: valida entrada -> llama al servicio -> responde. Sin lógica de negocio aquí.
export const profilesRouter = Router();

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, 'Solo minúsculas, números, "_" y "." (3-30)');

const updateMeBody = z
  .object({
    username: username.optional(),
    full_name: z.string().trim().max(60).nullable().optional(),
    bio: z.string().trim().max(150).nullable().optional(),
    avatar_path: z.string().max(200).nullable().optional(),
    is_private: z.boolean().optional(),
  })
  .strict() // rechaza campos extra (ej. alguien intentando mandar "id")
  .refine((b) => Object.keys(b).length > 0, 'Envía al menos un campo');

profilesRouter.get('/me', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.getMe(db, userId));
});

profilesRouter.patch('/me', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.updateMe(db, userId, updateMeBody.parse(req.body)));
});

// Debe ir ANTES de /users/:username para que "search" no se tome como username.
profilesRouter.get('/users/search', async (req, res) => {
  const { db } = getAuth(req);
  const { q } = z.object({ q: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{1,30}$/) }).parse(req.query);
  res.json(await service.searchUsers(db, q));
});

profilesRouter.get('/users/:username', async (req, res) => {
  const { db, userId } = getAuth(req);
  const params = z.object({ username }).parse(req.params);
  res.json(await service.getProfile(db, userId, params.username));
});

profilesRouter.get('/users/:id/followers', async (req, res) => {
  const { db } = getAuth(req);
  res.json(await service.listConnections(db, idParam.parse(req.params).id, 'followers'));
});

profilesRouter.get('/users/:id/following', async (req, res) => {
  const { db } = getAuth(req);
  res.json(await service.listConnections(db, idParam.parse(req.params).id, 'following'));
});
