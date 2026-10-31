import { expect,test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { startAcceptanceApp } from '../support/acceptance-app';
const contract=JSON.parse(readFileSync(join(process.cwd(),'specs/001-api-key-lifecycle/contracts/openapi.json'),'utf8'));
function matches(value:unknown,schema:any):boolean{
  if(schema.const!==undefined)return value===schema.const;
  if(schema.type==='object'){
    if(typeof value!=='object'||value===null||Array.isArray(value))return false;
    const object=value as Record<string,unknown>;
    return schema.required.every((key:string)=>Object.hasOwn(object,key))&&Object.keys(object).every(key=>Object.hasOwn(schema.properties,key)&&matches(object[key],schema.properties[key]));
  }
  return typeof value===schema.type;
}
test('actual HTTP authentication error matches the published OpenAPI envelope',async()=>{
  const app=await startAcceptanceApp();
  try{const response=await fetch(app.url+'/v1/api-keys');expect(response.status).toBe(401);const body:unknown=await response.json();expect(matches(body,contract.components.schemas['E-01'])).toBe(true);}
  finally{await app.close();}
});

test.each([
  ['POST','/v1/api-keys'],['GET','/v1/api-keys'],['POST','/v1/api-keys/revocations'],
  ['POST','/v1/api-keys/validations'],['GET','/v1/api-keys/00000000-0000-4000-8000-000000000001/secret'],
  ['POST','/v1/api-keys/00000000-0000-4000-8000-000000000001/reactivate'],
])('%s %s authentication failure supplies the published Bearer challenge',async(method,path)=>{
  const app=await startAcceptanceApp();
  try{const response=await fetch(app.url+path,{method});expect(response.status).toBe(401);expect(response.headers.get('www-authenticate')).toBe('Bearer');}
  finally{await app.close();}
});
test.each([undefined,'application/json'])('absent revocation body uses E-05 with Content-Type %s',async contentType=>{
  const app=await startAcceptanceApp();
  try{
    const headers:Record<string,string>={authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId};if(contentType)headers['content-type']=contentType;
    const response=await fetch(app.url+'/v1/api-keys/revocations',{method:'POST',headers});expect(response.status).toBe(400);
    expect(matches(await response.json(),contract.components.schemas['E-05'])).toBe(true);
  }finally{await app.close();}
});

test('a chunked zero-byte revocation body also reaches E-05 after authorization',async()=>{
  const app=await startAcceptanceApp();
  try{
    const result=await new Promise<{status:number;body:unknown}>((done,reject)=>{
      const req=request(app.url+'/v1/api-keys/revocations',{method:'POST',headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{
        let text='';res.on('data',chunk=>{text+=String(chunk);});res.on('end',()=>done({status:res.statusCode!,body:JSON.parse(text)}));
      });req.once('error',()=>reject(new Error('Contract transport failed')));req.end();
    });
    expect(result.status).toBe(400);expect(matches(result.body,contract.components.schemas['E-05'])).toBe(true);
  }finally{await app.close();}
});
