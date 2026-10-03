import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { idParam } from '../../lib/schemas.js';
import * as service from './stories.service.js';

export const storiesRouter = Router();

const createBody = z.object({ image_path: z.string().min(1).max(200) });

storiesRouter.get('/stories', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.getStoryTray(db, userId));
});

storiesRouter.post('/stories', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.status(201).json(await service.createStory(db, userId, createBody.parse(req.body).image_path));
});

storiesRouter.delete('/stories/:id', async (req, res) => {
  const { db } = getAuth(req);
  await service.deleteStory(db, idParam.parse(req.params).id);
  res.status(204).end();
});
