import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../../middleware/auth.js';
import { cursorQuery, idParam, uuid } from '../../lib/schemas.js';
import * as service from './messages.service.js';

export const messagesRouter = Router();

const openBody = z.object({ user_id: uuid });
const sendBody = z.object({
  id: uuid, // generado en la app -> reintentos idempotentes
  body: z.string().trim().min(1).max(2000),
});

messagesRouter.get('/conversations', async (req, res) => {
  const { db } = getAuth(req);
  res.json(await service.getInbox(db));
});

messagesRouter.post('/conversations', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.openConversation(db, userId, openBody.parse(req.body).user_id));
});

messagesRouter.get('/conversations/:id', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.getConversation(db, userId, idParam.parse(req.params).id));
});

messagesRouter.get('/conversations/:id/messages', async (req, res) => {
  const { db } = getAuth(req);
  const q = cursorQuery.parse(req.query);
  res.json(
    await service.listMessages(db, idParam.parse(req.params).id, { created_at: q.cursor_created_at, id: q.cursor_id }, q.limit),
  );
});

messagesRouter.post('/conversations/:id/messages', async (req, res) => {
  const { db, userId } = getAuth(req);
  const result = await service.sendMessage(db, userId, idParam.parse(req.params).id, sendBody.parse(req.body));
  res.status(result.created ? 201 : 200).json(result.message);
});

messagesRouter.post('/conversations/:id/read', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.markRead(db, userId, idParam.parse(req.params).id));
});

messagesRouter.post('/messages/delivered', async (req, res) => {
  const { db, userId } = getAuth(req);
  res.json(await service.markDelivered(db, userId));
});
