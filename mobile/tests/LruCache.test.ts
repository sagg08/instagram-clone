// Prueba unitaria de la LRU del motor de caché. Ejecutar con: npm test
import { LruCache } from '../src/core/imageCache/LruCache';
import assert from 'node:assert/strict';
const evicted: string[] = [];
const c = new LruCache<string, string>(30, (k) => evicted.push(k));
c.set('a', 'A', 10); c.set('b', 'B', 10); c.set('c', 'C', 10);
c.get('a');                       // a pasa a ser la más reciente -> orden: b, c, a
c.set('d', 'D', 10);              // excede 30 -> sale b (la menos reciente)
assert.deepEqual(evicted, ['b']);
c.pin('c');                       // c en pantalla
c.set('e', 'E', 10);              // debe salir a (c está fijada aunque es más vieja)
assert.deepEqual(evicted, ['b', 'a']);
c.set('f', 'F', 25);              // solo quedan fijadas o nuevas -> tolera exceso
assert.ok(c.has('c'));
c.unpin('c');                     // al soltar, se ajusta al presupuesto
assert.ok(c.bytes <= 30, `bytes=${c.bytes}`);
c.set('f', 'F2', 5);              // reemplazo libera la versión anterior
assert.ok(evicted.includes('f'));
c.pin('f'); c.trimUnpinned();     // presión de memoria: solo queda lo fijado
assert.deepEqual([c.size, c.has('f')], [1, true]);
console.log('✅ LRU: 6 escenarios OK. Desalojos en orden:', evicted.join(' → '));
