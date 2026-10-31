import type { DatabaseSync } from 'node:sqlite';
import type { CommitOutcome, MutationUnitOfWork } from '../../ports/mutation-unit-of-work';
export type { CommitOutcome } from '../../ports/mutation-unit-of-work';
export class SqliteUnitOfWork implements MutationUnitOfWork {
  constructor(private readonly connection: DatabaseSync) {}
  run<T>(operation: () => T): CommitOutcome<T> {
    let entered = false; let committing = false;
    try {
      if (operation.constructor.name === 'AsyncFunction' || this.connection.isTransaction) return { kind: 'not-committed' };
      this.connection.exec('BEGIN IMMEDIATE'); entered = true;
      const value = operation();
      if (value && typeof (value as { then?: unknown }).then === 'function') {
        Promise.resolve(value).catch(() => {}); throw new Error('async mutation');
      }
      committing = true; this.connection.exec('COMMIT');
      return { kind: 'committed', value };
    } catch {
      try {
        if (entered && this.connection.isTransaction) { this.connection.exec('ROLLBACK'); return { kind: 'not-committed' }; }
        return { kind: entered || committing ? 'uncertain' : 'not-committed' };
      } catch { return { kind: 'uncertain' }; }
    }
  }
}
