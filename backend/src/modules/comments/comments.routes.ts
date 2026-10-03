import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { idParam, uuid } from '../../lib/schemas.js';
import * as service from './comments.service.js';

export const commentsRouter = Router();

const createBody = z.object({
  id: uuid, // generado en la app (crypto.randomUUID) -> idempotencia
  body: z.string().trim().min(1).max(1000),
  parent_id: uuid.nullable().optional(),
});

commentsRouter.get('/posts/:id/comments', async (req, res) => {
  const { db } = getAuth(req);
  res.json(await service.listComments(db, idParam.parse(req.params).id));
});

commentsRouter.post('/posts/:id/comments', async (req, res) => {
  const { db, userId } = getAuth(req);
  const result = await service.createComment(db, userId, idParam.parse(req.params).id, createBody.parse(req.body));
  // 201 si se creó, 200 si era un reintento de algo que ya existía.
  res.status(result.created ? 201 : 200).json(result.comment);
});

commentsRouter.delete('/comments/:id', async (req, res) => {
  const { db } = getAuth(req);
  await service.deleteComment(db, idParam.parse(req.params).id);
  res.status(204).end();
});
