import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import type { Outcome } from '../../domain/outcome';
import { initializeSchema, schemaVersion, ensureTenantTimeIndex } from './schema';
export interface DatabaseHandle { connection: DatabaseSync; close(): void; }
export interface DatabaseOptions { path: string; initializeFreshStore?: boolean; }
export function openDatabase(options: DatabaseOptions): Outcome<DatabaseHandle> {
  let db: DatabaseSync | undefined;
  try {
    if (options.path === ':memory:' || !options.path || (existsSync(options.path) ? !statSync(options.path).isFile() : !options.initializeFreshStore)) return { ok: false, code: 'UNAVAILABLE' };
    const fresh = !existsSync(options.path);
    db = new DatabaseSync(options.path, { enableForeignKeyConstraints: true });
    const version = String(db.prepare('SELECT sqlite_version() AS version').get()!.version).split('.').map(Number);
    if (version[0] < 3 || version[0] === 3 && (version[1] < 51 || version[1] === 51 && version[2] < 3)) throw new Error('unsupported sqlite');
    db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const journal = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
    const synchronous = db.prepare('PRAGMA synchronous').get()?.synchronous;
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
    const busyTimeout = db.prepare('PRAGMA busy_timeout').get()?.timeout;
    if (journal !== 'wal' || synchronous !== 2 || foreignKeys !== 1 || busyTimeout !== 0) throw new Error('unsafe storage settings');
    if (fresh) initializeSchema(db);
    if (db.prepare('PRAGMA user_version').get()!.user_version !== schemaVersion || db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('unsafe store');
    db.prepare('SELECT keyId FROM api_keys LIMIT 0').all();
    db.prepare('SELECT attemptId FROM security_attempts LIMIT 0').all();
    ensureTenantTimeIndex(db);
    const connection = db; let closed = false;
    return { ok: true, value: { connection, close() { if (!closed) { connection.close(); closed = true; } } } };
  } catch {
    try { db?.close(); } catch { /* refuse readiness */ }
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
