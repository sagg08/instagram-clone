import { qk, queryClient } from '@/core/queryClient';
import { syncEngine } from '@/core/sync/syncEngine';
import * as postsApi from './postsApi';
import { patchPostInCaches } from './postsCache';

/** Cómo se sincroniza un like encolado (lo usa el motor de sync). */
syncEngine.register('like', {
  // PUT con estado final: idempotente, repetirlo tras un fallo no cambia el resultado.
  execute: (a) => postsApi.setLike(a.postId, a.liked),

  onSuccess: (a, result, { hasNewerPending }) => {
    // Si el usuario ya hizo OTRA acción sobre este post (sigue en la cola), no pisamos
    // su estado optimista más reciente con esta respuesta, que ya es vieja.
    if (hasNewerPending) return;
    const { like_count } = result as { like_count: number };
    patchPostInCaches(a.postId, (p) => ({ ...p, liked_by_me: a.liked, like_count }));
  },

  // Rechazo definitivo (ej. 404: el post ya no existe o la cuenta pasó a privada):
  // volvemos a pedir la verdad al servidor; eso deshace el like optimista.
  onPermanentFailure: (a) => {
    void queryClient.invalidateQueries({ queryKey: qk.feed });
    void queryClient.invalidateQueries({ queryKey: qk.post(a.postId) });
  },
});
