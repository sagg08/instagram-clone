import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { idParam, uuid } from '../../lib/schemas.js';
import * as service from './follows.service.js';

export const followsRouter = Router();

const followerParam = z.object({ followerId: uuid });

followsRouter.post('/users/:id/follow', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.follow(db, userId, idParam.parse(req.params).id));
});

followsRouter.delete('/users/:id/follow', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.unfollow(db, userId, idParam.parse(req.params).id));
});

followsRouter.get('/follow-requests', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.listIncomingRequests(db, userId));
});

followsRouter.post('/follow-requests/:followerId/accept', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.acceptRequest(db, userId, followerParam.parse(req.params).followerId));
});

followsRouter.delete('/follow-requests/:followerId', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.rejectRequest(db, userId, followerParam.parse(req.params).followerId));
});
