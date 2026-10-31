import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { publicError } from '../../src/domain/errors';
test('first, repeated and concurrent revokes return the exact original terminal metadata',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);
  try{
    const results=await Promise.all([app.developerToken,ids.colleagueToken].map(token=>apiRequest(app.url,'/v1/api-keys/revocations',token,{keyId:seed.record.keyId},app.tenantId)));
    for(const r of results){expect(r.status).toBe(200);expect(Object.keys(r.body).sort()).toEqual(['keyId','revokedAt','status']);expect(r.body.status).toBe('revoked');expect(r.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(r.body).includes(seed.apiKey)).toBe(false);}
    expect(results[0].body).toEqual(results[1].body);
    const repeat=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(repeat.status).toBe(200);expect(repeat.body).toEqual(results[0].body);
  }finally{db.close();await app.close();}
});
test('revocation has exact authentication/scope/id precedence and unknown/foreign indistinguishability',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const foreign=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,{...foreign.record,tenantId:'tenant-b'});
  try{
    for(const [token,tenantId,body,code,status] of [
      ['',undefined,{},'E-01',401],[app.developerToken,undefined,{},'E-02',400],[app.developerToken,'*',{},'E-03',400],
      [app.developerToken,'tenant-b',{},'E-04',403],[app.developerToken,app.tenantId,{},'E-05',400],
      [app.developerToken,app.tenantId,{keyId:'invalid'},'E-12',404],[app.developerToken,app.tenantId,{keyId:randomUUID()},'E-12',404],
      [app.developerToken,app.tenantId,{keyId:foreign.record.keyId},'E-12',404],
    ] as const){const r=await apiRequest(app.url,'/v1/api-keys/revocations',token,body,tenantId);expect(r.status).toBe(status);expect(r.body).toEqual({error:publicError(code)});expect(r.headers.get('cache-control')).toBe('no-store');}
    ids.unavailable=true;const down=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:randomUUID()},app.tenantId);expect(down.status).toBe(503);expect(down.body).toEqual({error:publicError('E-09')});
  }finally{db.close();await app.close();}
});
