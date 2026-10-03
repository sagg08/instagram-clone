import { syncEngine } from '@/core/sync/syncEngine';
import type { Comment } from '@/core/types';
import * as commentsApi from './commentsApi';
import { bumpCommentCount, markCommentFailed, upsertComment } from './commentsCache';

/** Cómo se sincroniza un comentario encolado. */
syncEngine.register('comment', {
  // POST con id generado en el cliente: si la respuesta se perdió y se reintenta,
  // el backend detecta el id repetido (PK) y devuelve el existente -> sin duplicados.
  execute: (a) => commentsApi.createComment(a.postId, { id: a.commentId, body: a.body, parent_id: a.parentId }),

  // El servidor devuelve el comentario con el MISMO id: reemplaza al pendiente en su lugar.
  onSuccess: (a, result) => upsertComment(a.postId, result as Comment),

  // Rechazo definitivo: se marca "no se pudo enviar" (no lo borramos en silencio).
  onPermanentFailure: (a) => {
    markCommentFailed(a.postId, a.commentId);
    bumpCommentCount(a.postId, -1);
  },
});
