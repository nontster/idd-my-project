import { expect, test } from '@jest/globals';
import { apiRequest, startAcceptanceApp } from '../support/acceptance-app';
import { publicError } from '../../src/domain/errors';
test('creation returns exactly the seven one-time fields and no-store',async()=>{
  const app=await startAcceptanceApp();try{
    const r=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['apiKey','createdAt','keyId','prefix','revokedAt','status','tenantId']);
    expect(r.body.revokedAt).toBe(null);expect(r.headers.get('cache-control')).toBe('no-store');
  }finally{await app.close();}
});
test('authentication and explicit scope errors preserve exact messages and precedence',async()=>{
  const app=await startAcceptanceApp();try{
    for(const [credential,selector,code,status] of [['',undefined,'E-01',401],[app.developerToken,undefined,'E-02',400],[app.developerToken,'*','E-03',400],[app.developerToken,'tenant-b','E-04',403]] as const){
      const r=await apiRequest(app.url,'/v1/api-keys',credential,{},selector);expect(r.status).toBe(status);expect(r.body).toEqual({error:publicError(code)});expect(r.headers.get('cache-control')).toBe('no-store');
    }
  }finally{await app.close();}
});
test('creation accepts an absent body and rejects unexpected body fields',async()=>{
  const app=await startAcceptanceApp();try{
    const headers={authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId};
    const absent=await fetch(app.url+'/v1/api-keys',{method:'POST',headers});expect(absent.status).toBe(201);
    const r=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{tenantId:'tenant-b'},app.tenantId);expect(r.status).toBe(400);expect(r.body.error.code).toBe('REQUEST_INVALID');
  }finally{await app.close();}
});
