// Prueba del motor de sincronización (módulo 3) con SQLite real y red simulada.
// Ejecutar con: npm run test:sync  (requiere Node 22.5 o superior por node:sqlite)
import assert from 'node:assert/strict';
(globalThis as any).__DEV__ = false;
const { outbox } = await import('./core/sync/outbox.ts');
const { syncEngine } = await import('./core/sync/syncEngine.ts');
const { ApiError } = await import('./mocks/client.ts');
const { setNet } = await import('./mocks/netinfo.ts');

const sent: string[] = [];
const failures: string[] = [];
let failNext: ApiError | null = null;
const exec = (label: string) => async () => { if (failNext) { const e = failNext; failNext = null; throw e; } sent.push(label); return { like_count: 1 }; };
syncEngine.register('like', {
  execute: (a: any) => exec(`like:${a.postId}=${a.liked}`)(),
  onPermanentFailure: (a: any) => { failures.push(`like:${a.postId}`); },
});
syncEngine.register('comment', { execute: (a: any) => exec(`comment:${a.body}`)() });
const settle = () => new Promise((r) => setTimeout(r, 60));
const comment = (body: string) => ({ type: 'comment', commentId: crypto.randomUUID(), postId: 'P', parentId: null, body, createdAt: '', author: { id: 'A', username: 'a', avatar_url: null } }) as any;

// 1) SIN RED: like/unlike/like al post P + comentario + like a Q
syncEngine.start('A');
setNet(false);
await outbox.enqueue('A', { type: 'like', postId: 'P', liked: true });
await outbox.enqueue('A', { type: 'like', postId: 'P', liked: false });
await outbox.enqueue('A', comment('hola'));
await outbox.enqueue('A', { type: 'like', postId: 'P', liked: true });
await outbox.enqueue('A', { type: 'like', postId: 'Q', liked: true });
await outbox.enqueue('B', { type: 'like', postId: 'Z', liked: true }); // de OTRO usuario
syncEngine.kick(); await settle();
assert.equal(sent.length, 0, 'sin red no se envía nada');
assert.equal(await outbox.count('A'), 3, 'compactación: 3 likes a P quedan en 1 (+ comentario + Q)');
console.log('✅ 1. Sin red: nada se envía; like→unlike→like al mismo post se compacta a 1 acción');

// 2) VUELVE LA RED: orden FIFO y solo el usuario actual
setNet(true); await settle();
assert.deepEqual(sent, ['comment:hola', 'like:P=true', 'like:Q=true']);
assert.equal(await outbox.count('A'), 0);
assert.equal(await outbox.count('B'), 1, 'la acción del usuario B NO se envió con la sesión de A');
console.log('✅ 2. Al volver la red: envío en orden cronológico ->', sent.join(' → '));
console.log('✅ 3. Aislamiento: la acción de otro usuario no se envía con esta sesión');

// 3) ERROR TEMPORAL (503) en la cabeza: se detiene la cola (FIFO), luego reintenta en orden
sent.length = 0;
failNext = new ApiError(503, 'X', 'servidor caído');
await outbox.enqueue('A', comment('primero'));
await outbox.enqueue('A', comment('segundo'));
syncEngine.kick(); await settle();
assert.deepEqual(sent, [], 'el segundo NO se adelanta al primero que falló');
const head = await outbox.head('A');
assert.equal(head!.attempts, 1); assert.ok(head!.next_attempt_at > Date.now(), 'backoff programado');
console.log(`✅ 4. Error 503: la cola se detiene en la cabeza (no se desordena); reintento en ${head!.next_attempt_at - Date.now()} ms`);
setNet(false); setNet(true); await settle(); // reconexión: resetea backoff
assert.deepEqual(sent, ['comment:primero', 'comment:segundo']);
console.log('✅ 5. Al reintentar: se envían en el orden original ->', sent.join(' → '));

// 4) ERROR PERMANENTE (404): se descarta, rollback, y la cola sigue
sent.length = 0;
failNext = new ApiError(404, 'NOT_FOUND', 'post borrado');
await outbox.enqueue('A', { type: 'like', postId: 'BORRADO', liked: true });
await outbox.enqueue('A', comment('después'));
syncEngine.kick(); await settle();
assert.deepEqual(failures, ['like:BORRADO']);
assert.deepEqual(sent, ['comment:después']);
console.log('✅ 6. Error 404: la acción se descarta con rollback y la cola continúa');

// 5) 401 (token vencido) NO se descarta: se reintenta
sent.length = 0;
failNext = new ApiError(401, 'INVALID_TOKEN', 'expirado');
await outbox.enqueue('A', comment('con token vencido'));
syncEngine.kick(); await settle();
assert.equal(await outbox.count('A'), 1, '401 se conserva para reintentar');
setNet(false); setNet(true); await settle();
assert.deepEqual(sent, ['comment:con token vencido']);
console.log('✅ 7. Error 401: no se pierde la acción; se reintenta tras refrescar el token');
syncEngine.stop();

// 6) CONCURRENCIA: 60 escrituras simultáneas (lo que en el iPhone dio "database is locked")
const { lockStats } = await import('./mocks/localDb.ts');
setNet(false);
const before = await outbox.count('C');
await Promise.all(Array.from({ length: 60 }, (_, i) =>
  i % 3 === 0
    ? outbox.enqueue('C', { type: 'like', postId: `post${i % 5}`, liked: i % 2 === 0 })
    : outbox.enqueue('C', comment(`c${i}`)),
));
assert.equal(lockStats.writesOutsideLock, 0, 'ninguna escritura fuera del mutex');
assert.equal(lockStats.maxConcurrentLocks, 1, 'nunca dos escrituras a la vez');
assert.equal((await outbox.count('C')) - before, 40 + 5, '40 comentarios + 5 posts con like compactado');
console.log('✅ 8. Concurrencia: 60 escrituras simultáneas, 0 solapes, 0 pérdidas (40 comentarios + 5 likes compactados)');
process.exit(0);
