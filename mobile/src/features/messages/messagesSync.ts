import { qk, queryClient } from '@/core/queryClient';
import { syncEngine } from '@/core/sync/syncEngine';
import type { Message } from '@/core/types';
import * as messagesApi from './messagesApi';
import { markMessageFailed, upsertMessage } from './messagesCache';

/**
 * Los mensajes reutilizan la MISMA cola offline que likes y comentarios:
 * escribir sin red funciona, y se envían en orden cuando vuelve la conexión.
 * Agregar este tipo de acción no requirió tocar el motor de sincronización.
 */
syncEngine.register('message', {
  execute: (a) => messagesApi.sendMessage(a.conversationId, { id: a.messageId, body: a.body }),

  onSuccess: (_a, result) => {
    upsertMessage(result as Message); // reemplaza al pendiente (mismo id) -> "Enviado"
    void queryClient.invalidateQueries({ queryKey: qk.inbox }); // reordena la bandeja
  },

  onPermanentFailure: (a) => markMessageFailed(a.conversationId, a.messageId),
});
