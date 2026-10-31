import type { DatabaseSync } from 'node:sqlite';
import { securityAttempt, type SecurityAttempt } from '../../domain/security-attempt';
import type { Outcome } from '../../domain/outcome';
import type { SecurityEventRepository } from '../../ports/security-event-repository';
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
export class SqliteSecurityEvents implements SecurityEventRepository {
  constructor(private readonly connection: DatabaseSync) {}
  begin(attempt: SecurityAttempt): Outcome<void> {
    try {
      const checked = securityAttempt(attempt);
      if (!checked.ok || checked.value.finalized) return unavailable;
      const v = checked.value;
      this.connection.prepare('INSERT INTO security_attempts (attemptId,operation,receivedAt,callerId,tenantId,keyId,outcome,finalized,errorCode,completedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(v.attemptId,v.operation,v.receivedAt,v.callerId,v.tenantId,v.keyId,v.outcome,0,v.errorCode,v.completedAt);
      return { ok: true, value: undefined };
    } catch { return unavailable; }
  }
  finalize(attempt: SecurityAttempt): Outcome<void> {
    try {
      const checked = securityAttempt(attempt);
      if (!checked.ok || !checked.value.finalized) return unavailable;
      const v = checked.value;
      const result = this.connection.prepare('UPDATE security_attempts SET callerId=?,tenantId=?,keyId=?,outcome=?,finalized=1,errorCode=?,completedAt=? WHERE attemptId=? AND finalized=0 AND operation=? AND receivedAt=?')
        .run(v.callerId,v.tenantId,v.keyId,v.outcome,v.errorCode,v.completedAt,v.attemptId,v.operation,v.receivedAt);
      return result.changes === 1 ? { ok: true, value: undefined } : unavailable;
    } catch { return unavailable; }
  }
  unfinished(): Outcome<readonly SecurityAttempt[]> {
    try {
      const values: SecurityAttempt[] = [];
      for (const row of this.connection.prepare('SELECT * FROM security_attempts WHERE finalized=0').all()) {
        const checked = securityAttempt({ ...row, finalized: row.finalized === 1 });
        if (!checked.ok) return unavailable;
        values.push(checked.value);
      }
      return { ok: true, value: values };
    } catch { return unavailable; }
  }
}
