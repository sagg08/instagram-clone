// SQLite REAL en memoria (node:sqlite) con la misma API asíncrona que expo-sqlite.
// Detecta si dos escrituras se SOLAPAN (lo que en el teléfono produjo "database is locked").
import { DatabaseSync } from 'node:sqlite';
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, type TEXT NOT NULL, entity_key TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL);`);

export const lockStats = { writesOutsideLock: 0, maxConcurrentLocks: 0 };
let activeLocks = 0;
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3)); // latencia: provoca solapes si no hay mutex
const isWrite = (sql: string) => /^\s*(insert|update|delete|begin|commit|rollback)/i.test(sql);

const db = {
  async runAsync(sql: string, ...p: any[]) {
    if (isWrite(sql) && activeLocks === 0) lockStats.writesOutsideLock++;
    await tick();
    return raw.prepare(sql).run(...p);
  },
  async getFirstAsync(sql: string, ...p: any[]) { await tick(); return raw.prepare(sql).get(...p) ?? null; },
  async getAllAsync(sql: string, ...p: any[]) { await tick(); return raw.prepare(sql).all(...p); },
  async execAsync(sql: string) { raw.exec(sql); },
  async withTransactionAsync(cb: () => Promise<void>) {
    raw.exec('BEGIN');
    try { await cb(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};
export const getDb = async () => db;

// Misma implementación que src/core/db/localDb.ts, instrumentada.
let writeChain: Promise<unknown> = Promise.resolve();
export function withWriteLock<T>(task: (d: typeof db) => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    activeLocks++;
    lockStats.maxConcurrentLocks = Math.max(lockStats.maxConcurrentLocks, activeLocks);
    try { return await task(db); } finally { activeLocks--; }
  });
  writeChain = run.catch(() => {});
  return run;
}
