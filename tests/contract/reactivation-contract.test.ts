import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { publicError } from '../../src/domain/errors';
test('reactivation is rejection-only for active, revoked, unknown and foreign keys, without state mutation',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const active=sampleKeyRecord();const revoked=sampleKeyRecord();const foreign=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);
  insertSeed(db,active.record);insertSeed(db,{...revoked.record,status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});insertSeed(db,{...foreign.record,tenantId:'tenant-b'});
  try{
    const before=db.prepare('SELECT keyId,status,generation,revokedAt,revocationAttemptId FROM api_keys ORDER BY keyId').all();
    for(const [id,code,status] of [[active.record.keyId,'E-15',400],[revoked.record.keyId,'E-13',409],[foreign.record.keyId,'E-12',404],[randomUUID(),'E-12',404],['invalid','E-12',404]] as const){
      const r=await apiRequest(app.url,`/v1/api-keys/${id}/reactivate`,app.developerToken,{},app.tenantId);expect(r.status).toBe(status);expect(r.body).toEqual({error:publicError(code)});expect(r.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(r.body).includes(revoked.apiKey)).toBe(false);
    }
    const unauth=await apiRequest(app.url,`/v1/api-keys/${revoked.record.keyId}/reactivate`,'',{},app.tenantId);expect(unauth.status).toBe(401);
    ids.unavailable=true;const down=await apiRequest(app.url,`/v1/api-keys/${revoked.record.keyId}/reactivate`,app.developerToken,{},app.tenantId);expect(down.status).toBe(503);expect(down.body).toEqual({error:publicError('OPERATION_UNAVAILABLE')});
    expect(db.prepare('SELECT keyId,status,generation,revokedAt,revocationAttemptId FROM api_keys ORDER BY keyId').all()).toEqual(before);
  }finally{db.close();await app.close();}
});
