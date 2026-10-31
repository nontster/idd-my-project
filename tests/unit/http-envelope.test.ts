import { expect,test } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { api,errorStatus,type HttpDependencies } from '../../src/routes/api';
import { RequestCoordinator,type Invocation,type Operation,type Session } from '../../src/services/management-attempt';
import { AuthenticationService } from '../../src/services/authentication';
import type { Outcome } from '../../src/domain/outcome';
import type { RequestContext } from '../../src/domain/request-context';
import { ListingService } from '../../src/services/listing';
import { SqliteListingRepository } from '../../src/adapters/sqlite/listing-repository';
import { createIdentityFixtures,manualClock,deferred } from '../support/identity-fixtures';
import { databaseFixture } from '../support/database-fixture';
function fixture(){
  const ids=createIdentityFixtures();const clock=manualClock();const auth=new AuthenticationService(ids.verifier);
  const deps:HttpDependencies={clock,identityTimeoutMs:100,validationTimeoutMs:200,managementTimeoutMs:2000,coordinator:new RequestCoordinator(auth),log:()=>true,ready:()=>true};
  return {ids,clock,auth,deps};
}
function invoke(deps:HttpDependencies,ids:ReturnType<typeof createIdentityFixtures>,options:{url?:string;missingUrl?:boolean;method?:string;headers?:Record<string,string>;rawHeaders?:string[];chunks?:string[];stream?:()=>AsyncGenerator<Buffer>;ended?:boolean}={}){
  const request=Object.assign(new EventEmitter(),{url:options.missingUrl?undefined:options.url??'/v1/api-keys',method:options.method??'POST',headers:{authorization:`Bearer ${ids.developerToken}`,'content-type':'application/json',...options.headers},rawHeaders:options.rawHeaders??['x-tenant-id','tenant-a'],async *[Symbol.asyncIterator](){if(options.stream){yield* options.stream();return;}for(const chunk of options.chunks??['{}'])yield Buffer.from(chunk);}});
  let writes=0;let status=0;const headers:Record<string,string>={};let finish!:(value:{status:number;body:Record<string,unknown>&{error:{code:string}};headers:Record<string,string>})=>void;
  const result=new Promise<{status:number;body:Record<string,unknown>&{error:{code:string}};headers:Record<string,string>}>(done=>finish=done);
  const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:options.ended??false,writableFinished:false,
    writeHead(code:number,values:Record<string,string>){writes++;status=code;Object.assign(headers,values);return this;},
    end(value:string){this.writableEnded=true;this.writableFinished=true;finish({status,headers,body:JSON.parse(value) as Record<string,unknown>&{error:{code:string}}});return this;}});
  api(deps)(request as unknown as IncomingMessage,response as unknown as ServerResponse);
  return {result,request,response,writes:()=>writes};
}
test('HTTP-only path/method/fallback guards never require or invent a key verdict',async()=>{
  const f=fixture();expect(errorStatus('unknown')).toBe(503);
  for(const options of [{missingUrl:true,method:'GET'},{url:'http://[',method:'GET'},{url:'/v1/api-keys/revocations',method:'GET'},{url:`/v1/api-keys/${randomUUID()}/secret`,method:'POST'}]){
    const r=await invoke(f.deps,f.ids,options).result;expect([400,404,405].includes(r.status)).toBe(true);expect(r.headers['cache-control']).toBe('no-store');
  }
  const ready=await invoke({...f.deps,ready:()=>false},f.ids,{url:'/health/ready',method:'GET'}).result;expect(ready.status).toBe(503);expect(ready.body).toEqual({ready:false});
  const ended=invoke(f.deps,f.ids,{url:'/missing',ended:true});await new Promise<void>(done=>setImmediate(done));expect(ended.writes()).toBe(0);
});
test('invalid clocks and duplicate scopes fail before any configured business handler',async()=>{
  const f=fixture();const bad=await invoke({...f.deps,clock:{...f.clock,monotonicNow:()=>Number.NaN}},f.ids).result;expect(bad.status).toBe(503);expect(bad.body.error.code).toBe('E-08');
  const duplicate=await invoke(f.deps,f.ids,{rawHeaders:['x-tenant-id','tenant-a','X-Tenant-ID','tenant-a']}).result;expect(duplicate.status).toBe(400);expect(duplicate.body.error.code).toBe('E-03');
});
test('JSON framing preserves optional-empty creation, rejects non-objects/missing media type and leaves unwired handlers honest',async()=>{
  const f=fixture();
  const empty=await invoke(f.deps,f.ids,{headers:{'transfer-encoding':'chunked'},chunks:[]}).result;expect(empty.status).toBe(501);expect(empty.body.error.code).toBe('NOT_IMPLEMENTED');
  const array=await invoke(f.deps,f.ids,{headers:{'transfer-encoding':'chunked'},chunks:['[]']}).result;expect(array.status).toBe(400);expect(array.body.error.code).toBe('REQUEST_INVALID');
  const missing=await invoke(f.deps,f.ids,{headers:{'transfer-encoding':'chunked','content-type':undefined as unknown as string}}).result;expect(missing.status).toBe(415);
});
test('a stalled body stops waiting at expiry without response diagnostics or late success',async()=>{
  const f=fixture();const reading=deferred();const release=deferred();
  const pending=invoke(f.deps,f.ids,{headers:{'transfer-encoding':'chunked'},stream:async function*(){yield Buffer.from('{');reading.resolve();await release.promise;}}).result;
  try{await reading.promise;f.clock.advance(2000);const r=await pending;expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-08');}
  finally{release.resolve();}
});
test('throwing orchestration and non-serializable service output become fixed operation failures before success headers',async()=>{
  const f=fixture();const sentinel=randomUUID();
  class FailedPreflight extends RequestCoordinator{override async preflight():Promise<Outcome<Session>>{throw new Error(sentinel);}}
  const failed=await invoke({...f.deps,coordinator:new FailedPreflight(f.auth)},f.ids).result;expect(failed.status).toBe(503);expect(failed.body.error.code).toBe('E-08');expect(JSON.stringify(failed.body).includes(sentinel)).toBe(false);
  const malformed=new RequestCoordinator(f.auth,{list:async()=>({ok:true,value:BigInt(1)})});
  const r=await invoke({...f.deps,coordinator:malformed},f.ids,{method:'GET'}).result;expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-14');
});
test('a real complete SQL listing expiring across the orchestration-return boundary never emits 2xx',async()=>{
  const f=fixture();const db=databaseFixture();const listing=new ListingService(new SqliteListingRepository(db.connection));
  class LateReturn extends RequestCoordinator{override async execute(operation:Operation,input:Invocation){const result=await super.execute(operation,input);queueMicrotask(()=>f.clock.advance(2000,false));return result;}}
  const coordinator=new LateReturn(f.auth,{list:input=>listing.list({principal:input.session.principal,tenantId:input.session.tenantId!},input.context)});
  try{const r=await invoke({...f.deps,coordinator},f.ids,{method:'GET'}).result;expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-14');}
  finally{db.cleanup();}
});
