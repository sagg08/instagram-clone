import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

// En desarrollo escucha en tu red local para que el iPhone (Expo Go) llegue al backend.
// No abre nada a internet: el router de tu casa no reenvía este puerto hacia afuera.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`✅ API escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// Apagado ordenado: termina las peticiones en curso antes de salir.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} recibido, cerrando servidor...`);
    server.close(() => process.exit(0));
  });
}
