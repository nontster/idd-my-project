import { expect,test } from '@jest/globals';
import { startAcceptanceApp } from '../support/acceptance-app';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { publicError } from '../../src/domain/errors';
test('an empty authorized Tenant returns exactly a complete empty collection with no-store',async()=>{
  const app=await startAcceptanceApp();try{const r=await fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});expect(r.status).toBe(200);expect(await r.json()).toEqual({items:[]});expect(r.headers.get('cache-control')).toBe('no-store');}finally{await app.close();}
});
test('listing preserves exact authentication, scope and availability errors',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);try{
    for(const [token,tenant,code,status] of [['',undefined,'E-01',401],[app.developerToken,undefined,'E-02',400],[app.developerToken,'*','E-03',400],[app.developerToken,'tenant-b','E-04',403],[app.serviceToken,app.tenantId,'E-04',403]] as const){
      const headers:Record<string,string>={authorization:`Bearer ${token}`};if(tenant!==undefined)headers['x-tenant-id']=tenant;const r=await fetch(app.url+'/v1/api-keys',{headers});expect(r.status).toBe(status);expect(await r.json()).toEqual({error:publicError(code)});expect(r.headers.get('cache-control')).toBe('no-store');
    }
    ids.unavailable=true;const r=await fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});expect(r.status).toBe(503);expect(await r.json()).toEqual({error:publicError('E-14')});
  }finally{await app.close();}
});
