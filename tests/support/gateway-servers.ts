import { createServer,type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isUuid } from '../../src/domain/values';
import { GatewayEnforcement,type ValidationClient,type AuthorityReply,type ValidationRequest } from '../../src/gateway/enforcement';
import { systemClock } from '../../src/adapters/clock/system-clock';
import { requestScope } from '../../src/domain/request-context';
import type { Clock } from '../../src/ports/clock';
import { publicError } from '../../src/domain/errors';
import type { TestApp } from './acceptance-app';
export interface GatewayControls {
  partitioned:boolean; calls:number; requestIds:string[];
  afterResponse?: (reply:AuthorityReply,request:ValidationRequest)=>Promise<void>;
  transform?: (reply:AuthorityReply)=>AuthorityReply;
}
async function listen(server:Server){await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture listener unavailable');return `http://127.0.0.1:${address.port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
export async function startGatewayServer(app:TestApp,options:{clock?:Clock;timeoutMs?:number}={}){
  const observations=new AsyncLocalStorage<{loadId?:string}>();
  const clock=options.clock??systemClock;const controls:GatewayControls={partitioned:false,calls:0,requestIds:[]};
  const offline=createServer();const offlineUrl=await listen(offline);await close(offline);
  const client:ValidationClient={async validate(request,context){
    controls.calls++;controls.requestIds.push(request.requestId);
    const headers:Record<string,string>={authorization:`Bearer ${app.serviceToken}`,'content-type':'application/json'};
    const loadId=observations.getStore()?.loadId;if(loadId)headers['x-load-id']=loadId;
    const response=await fetch((controls.partitioned?offlineUrl:app.url)+'/v1/api-keys/validations',{method:'POST',signal:context.signal,headers,body:JSON.stringify(request)});
    const reply:AuthorityReply={status:response.status,body:await response.json()};
    if(controls.afterResponse)await controls.afterResponse(reply,request);
    return controls.transform?controls.transform(reply):reply;
  }};
  const enforcement=new GatewayEnforcement(client,clock,randomUUID,options.timeoutMs??500);
  const server=createServer((request,response)=>{void(async()=>{
    const scope=requestScope(clock,5000,100);if(!scope.ok){response.writeHead(503);response.end();return;}
    const cancel=scope.value.cancel;request.once('aborted',cancel);response.once('close',()=>{if(!response.writableFinished)cancel();});
    try{
      const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {apiKey:unknown;expectedTenantId:string};
      const tag=request.headers['x-load-id'];const loadId=isUuid(tag)?tag:undefined;
      const result=await observations.run({loadId},()=>enforcement.admit(input.apiKey,input.expectedTenantId,scope.value.context));
      if(!response.destroyed){response.writeHead(result.ok?200:result.code==='E-07'?403:503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(result.ok?result.value:{error:publicError(result.code)}));}
    }catch{if(!response.destroyed){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:publicError('E-10')}));}}
    finally{scope.value.dispose();}
  })();});
  return {url:await listen(server),enforcement,client,controls,clock,cacheSize:()=>enforcement.cacheEntries().length,close:()=>close(server)};
}
