// Copia el código REAL de la outbox y el motor a un directorio ESM aislado y ejecuta
// la prueba con dependencias nativas simuladas (red, SQLite, React Native).
import { cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'src', 'core', 'sync');
const dest = join(here, 'core', 'sync');
mkdirSync(dest, { recursive: true });
for (const f of ['outbox.ts', 'syncEngine.ts']) cpSync(join(src, f), join(dest, f));

const r = spawnSync('npx', ['tsx', '--no-warnings', '--import', './register.mjs', './sync.test.mts'], {
  cwd: here,
  stdio: 'inherit',
  shell: process.platform === 'win32', // en Windows npx es npx.cmd
});
process.exit(r.status ?? 1);
