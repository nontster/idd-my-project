import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { publicError } from '../../src/domain/errors';
test('validation requires separate verified service identity before any key/context checks',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);try{
    for(const [token,body,code,status] of [
      ['',{},'E-01',401],[app.developerToken,{apiKey:{}},'E-16',403],[ids.untrustedServiceToken,{},'E-16',403],
      [app.serviceToken,{},'E-06',400],[app.serviceToken,{apiKey:'',expectedTenantId:null},'E-06',400],
      [app.serviceToken,{apiKey:'malformed'},'E-10',503],[app.serviceToken,{apiKey:'malformed',expectedTenantId:app.tenantId,requestId:'invalid'},'E-10',503],
    ] as const){const r=await apiRequest(app.url,'/v1/api-keys/validations',token,body);expect(r.status).toBe(status);expect(r.body).toEqual({error:publicError(code)});expect(r.headers.get('cache-control')).toBe('no-store');}
  }finally{await app.close();}
});
test('validation binds the supplied UUID to one safe response and rejects unconfirmable expected context',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();
  try{
    const requestId=randomUUID();const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId,requestId});
    expect(r.status).toBe(200);expect(r.body.requestId).toBe(requestId);expect(r.body.tenantId).toBe(app.tenantId);
    expect(Object.keys(r.body).sort()).toEqual(['decisionId','generation','keyId','requestId','tenantId']);
    for(const expectedTenantId of ['',null,'tenant-unknown']){const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId,requestId:randomUUID()});expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-10');}
  }finally{await app.close();}
});
