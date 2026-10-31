import type { DatabaseSync } from 'node:sqlite';
export const schemaVersion = 1;
const tenantTimeIndexSql = 'CREATE INDEX IF NOT EXISTS keys_tenant_created_at ON api_keys(tenantId,createdAt,keyId)';
// Additive preparation preserves the supported version1 record/event format.
export function ensureTenantTimeIndex(db: DatabaseSync): void {
  db.exec(tenantTimeIndexSql);
  const index = db.prepare("SELECT name FROM pragma_index_list('api_keys') WHERE name='keys_tenant_created_at' AND \"unique\"=0 AND partial=0").get();
  const columns = db.prepare('PRAGMA index_info(keys_tenant_created_at)').all().map(row => row.name).join(',');
  if (!index || columns !== 'tenantId,createdAt,keyId') throw new Error('unsafe Tenant index');
}
export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE security_attempts (
      attemptId TEXT PRIMARY KEY NOT NULL CHECK(length(attemptId)=36),
      operation TEXT NOT NULL CHECK(operation IN ('create','revoke')),
      receivedAt TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',receivedAt)=receivedAt),
      callerId TEXT CHECK(callerId IS NULL OR length(callerId)>0),
      tenantId TEXT CHECK(tenantId IS NULL OR length(tenantId) BETWEEN 1 AND 256),
      keyId TEXT CHECK(keyId IS NULL OR length(keyId)=36),
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','rejected','failed','unconfirmed')),
      finalized INTEGER NOT NULL CHECK(finalized IN (0,1)),
      errorCode TEXT CHECK(errorCode IS NULL OR errorCode IN (
        'E-01','E-02','E-03','E-04','E-05','E-06','E-07','E-08','E-09','E-10','E-11','E-12','E-13','E-14','E-15','E-16',
        'REQUEST_INVALID','REQUEST_TOO_LARGE','UNSUPPORTED_MEDIA_TYPE','NOT_FOUND','METHOD_NOT_ALLOWED','OPERATION_UNAVAILABLE')),
      completedAt TEXT,
      CHECK((finalized=0 AND outcome='unconfirmed' AND completedAt IS NULL) OR
        (finalized=1 AND outcome!='unconfirmed' AND completedAt IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',completedAt)=completedAt))
    ) STRICT;
    CREATE TABLE api_keys (
      keyId TEXT PRIMARY KEY NOT NULL CHECK(length(keyId)=36),
      tenantId TEXT NOT NULL CHECK(length(tenantId) BETWEEN 1 AND 256),
      prefix TEXT NOT NULL CHECK(length(prefix)=8 AND prefix NOT GLOB '*[^A-Za-z0-9_-]*'),
      salt BLOB NOT NULL CHECK(length(salt)=16),
      keyHash BLOB NOT NULL CHECK(length(keyHash)=32),
      status TEXT NOT NULL CHECK(status IN ('active','revoked')),
      generation INTEGER NOT NULL,
      createdAt TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',createdAt)=createdAt),
      revokedAt TEXT,
      creationAttemptId TEXT NOT NULL UNIQUE REFERENCES security_attempts(attemptId),
      revocationAttemptId TEXT REFERENCES security_attempts(attemptId),
      CHECK((status='active' AND generation=1 AND revokedAt IS NULL AND revocationAttemptId IS NULL) OR
        (status='revoked' AND generation=2 AND revokedAt IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',revokedAt)=revokedAt AND revocationAttemptId IS NOT NULL))
    ) STRICT;
    CREATE INDEX keys_prefix ON api_keys(prefix);
    CREATE INDEX keys_tenant ON api_keys(tenantId,keyId);
    CREATE INDEX keys_tenant_prefix ON api_keys(tenantId,prefix);
    ${tenantTimeIndexSql};
    CREATE TRIGGER immutable_key BEFORE UPDATE ON api_keys WHEN
      NEW.keyId IS NOT OLD.keyId OR NEW.tenantId IS NOT OLD.tenantId OR NEW.prefix IS NOT OLD.prefix OR
      NEW.salt IS NOT OLD.salt OR NEW.keyHash IS NOT OLD.keyHash OR NEW.createdAt IS NOT OLD.createdAt OR NEW.creationAttemptId IS NOT OLD.creationAttemptId OR
      (OLD.status='revoked' AND (NEW.status IS NOT OLD.status OR NEW.generation IS NOT OLD.generation OR NEW.revokedAt IS NOT OLD.revokedAt OR NEW.revocationAttemptId IS NOT OLD.revocationAttemptId))
      BEGIN SELECT RAISE(ABORT,'immutable key'); END;
    CREATE TRIGGER retained_key BEFORE DELETE ON api_keys BEGIN SELECT RAISE(ABORT,'retained key'); END;
    PRAGMA user_version=1;
    COMMIT;
  `);
}
