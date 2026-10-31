import { expect,test,jest } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { manualClock } from '../support/identity-fixtures';
test.each(['list','create'] as const)('%s cannot emit success if response preparation crosses its absolute management deadline',async operation=>{
  const clock=manualClock();const app=await startAcceptanceApp({clock});const original=JSON.stringify;
  const spy=jest.spyOn(JSON,'stringify').mockImplementation((value,replacer,space)=>{
    const encoded=original(value,replacer as (string|number)[]|null|undefined,space);
    if(value&&typeof value==='object'&&(operation==='list'?'items' in value:'apiKey' in value))clock.advance(2000,false);
    return encoded;
  });
  try{
    const r=operation==='create'?await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId):await(async()=>{const response=await fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});return {status:response.status,body:await response.json() as Record<string,unknown>&{error:{code:string}}};})();
    expect(r.status).toBe(503);expect(r.body.error.code).toBe(operation==='create'?'E-08':'E-14');expect(Object.keys(r.body).sort()).toEqual(['error']);
    if(operation==='create'){const observer=new DatabaseSync(app.databasePath,{readOnly:true});try{expect(observer.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);expect(observer.prepare('SELECT outcome FROM security_attempts').get()?.outcome).toBe('succeeded');}finally{observer.close();}}
  }finally{spy.mockRestore();await app.close();}
});
