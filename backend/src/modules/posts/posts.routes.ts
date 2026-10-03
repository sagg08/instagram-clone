import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { idParam, cursorQuery } from '../../lib/schemas.js';
import * as service from './posts.service.js';

export const postsRouter = Router();

const createBody = z.object({
  image_path: z.string().min(1).max(200),
  caption: z.string().trim().max(2200).nullable().optional(),
});

const likeBody = z.object({ liked: z.boolean() });

postsRouter.get('/feed', async (req, res) => {
  const { db } = getAuth(req);
  const q = cursorQuery.parse(req.query);
  res.json(await service.getFeed(db, { created_at: q.cursor_created_at, id: q.cursor_id }, q.limit));
});

postsRouter.post('/posts', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.status(201).json(await service.createPost(db, userId, createBody.parse(req.body)));
});

postsRouter.get('/posts/:id', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.getPost(db, userId, idParam.parse(req.params).id));
});

postsRouter.delete('/posts/:id', async (req, res) => {
  const { db } = getAuth(req);
  await service.deletePost(db, idParam.parse(req.params).id);
  res.status(204).end();
});

// PUT (no POST) porque fija un estado: repetirlo no cambia el resultado.
postsRouter.put('/posts/:id/like', async (req, res) => {
  const { db, userId } = getAuth(req);
  const { liked } = likeBody.parse(req.body);
  res.json(await service.setLike(db, userId, idParam.parse(req.params).id, liked));
});

postsRouter.get('/users/:id/posts', async (req, res) => {
  const { db } = getAuth(req);
  const q = cursorQuery.parse(req.query);
  res.json(
    await service.listUserPosts(
      db,
      idParam.parse(req.params).id,
      { created_at: q.cursor_created_at, id: q.cursor_id },
      q.limit,
    ),
  );
});
