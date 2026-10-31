import type { IncomingMessage, ServerResponse } from 'node:http';
import { publicError } from '../domain/errors';
import { isObject } from '../domain/values';
import { isActive, requestScope, withinContext } from '../domain/request-context';
import type { Clock } from '../ports/clock';
import { unavailableCode, type Operation, type ManagedAttempt, type RequestCoordinator } from '../services/management-attempt';
export function errorStatus(code: string): number {
  return ({ 'E-01':401,'E-02':400,'E-03':400,'E-04':403,'E-05':400,'E-06':400,'E-07':403,'E-08':503,'E-09':503,'E-10':503,'E-11':409,'E-12':404,'E-13':409,'E-14':503,'E-15':400,'E-16':403,
    REQUEST_INVALID:400,REQUEST_TOO_LARGE:413,UNSUPPORTED_MEDIA_TYPE:415,NOT_FOUND:404,METHOD_NOT_ALLOWED:405,OPERATION_UNAVAILABLE:503,NOT_IMPLEMENTED:501 } as Record<string,number>)[code] ?? 503;
}
export interface HttpDependencies {
  clock: Clock; identityTimeoutMs: number; validationTimeoutMs: number; managementTimeoutMs: number;
  coordinator: RequestCoordinator; log: (event: {operation:string; status:number; code?:string}) => boolean;
  ready(): boolean;
}
export function api(deps: HttpDependencies) {
  return (request: IncomingMessage, response: ServerResponse) => { void handle(request,response); };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let operation: Operation | undefined;
    let dispose = () => {};
    let attempt:ManagedAttempt|null=null;
    let requestContext:import('../domain/request-context').RequestContext|undefined;
    let completionCode:string|null='OPERATION_UNAVAILABLE';
    const send = (status: number, body: unknown, code?: string) => {
      let serialized=JSON.stringify(code?{error:body}:body);
      if(status>=200&&status<300&&requestContext&&!isActive(requestContext)){
        code=unavailableCode(operation!);status=503;body=publicError(code);serialized=JSON.stringify({error:body});
      }
      completionCode=code ?? null;
      if(requestContext&&!deps.coordinator.complete(attempt,completionCode,requestContext)){
        code=unavailableCode(operation!);status=503;body=publicError(code);serialized=JSON.stringify({error:body});
      }
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {'content-type':'application/json','cache-control':'no-store',...(status===401?{'www-authenticate':'Bearer'}:{})});
      res.end(serialized); deps.log({operation:operation ?? 'transport',status,code});
    };
    const fail = (code: string) => send(errorStatus(code), code === 'NOT_IMPLEMENTED' ? {code,message:'Capability is not implemented.'} : publicError(code),code);
    try {
      const path = new URL(req.url ?? '/', 'http://local').pathname;
      if (path === '/health/ready' && req.method === 'GET') { const ready=deps.ready(); send(ready?200:503,{ready}); return; }
      const rejection = /^\/v1\/api-keys\/([^/]+)\/(secret|reactivate)$/.exec(path);
      let keyId: string | undefined;
      if (path === '/v1/api-keys') {
        if (req.method === 'POST') operation='create'; else if (req.method === 'GET') operation='list'; else { fail('METHOD_NOT_ALLOWED'); return; }
      } else if (path === '/v1/api-keys/revocations' || path === '/v1/api-keys/validations') {
        if (req.method !== 'POST') { fail('METHOD_NOT_ALLOWED'); return; }
        operation=path.endsWith('revocations')?'revoke':'validate';
      } else if (rejection) {
        const expected = rejection[2] === 'secret' ? 'GET':'POST';
        if (req.method !== expected) { fail('METHOD_NOT_ALLOWED'); return; }
        operation=rejection[2]==='secret'?'retrieve':'reactivate'; keyId=rejection[1];
      } else { fail('NOT_FOUND'); return; }
      const scope=requestScope(deps.clock,operation==='validate'?deps.validationTimeoutMs:deps.managementTimeoutMs,deps.identityTimeoutMs);
      if (!scope.ok) { fail(unavailableCode(operation)); return; }
      dispose=scope.value.dispose; const context=scope.value.context;requestContext=context;
      const received=deps.coordinator.received(operation,context);
      if(!received.ok){fail(unavailableCode(operation));return;}attempt=received.value;
      const cancel=scope.value.cancel;
      req.once('aborted',cancel); res.once('close',()=>{if(!res.writableFinished)cancel();});
      const authorization=req.headers.authorization;
      const credential=typeof authorization==='string' && authorization.startsWith('Bearer ')?authorization.slice(7):undefined;
      const selectors: string[]=[];
      for(let i=0;i<req.rawHeaders.length;i+=2) if(req.rawHeaders[i].toLowerCase()==='x-tenant-id')selectors.push(req.rawHeaders[i+1]);
      const selector=selectors.length>1?selectors:selectors[0];
      const session=await deps.coordinator.preflight(operation,credential,selector,context,attempt);
      if(!session.ok){fail(session.code);return;}
      let body: Record<string,unknown>={};
      const absentOptionalBody=(operation==='create'||operation==='revoke')&&!req.headers['transfer-encoding']&&(!req.headers['content-length']||req.headers['content-length']==='0');
      if(req.method==='POST'&&operation!=='reactivate'&&!absentOptionalBody) {
        if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')){fail('UNSUPPORTED_MEDIA_TYPE');return;}
        const read=await withinContext(context,async()=>{
          const chunks: Buffer[]=[]; let size=0;
          for await(const part of req){size+=part.length;if(size<=8192)chunks.push(Buffer.from(part));}
          if(size>8192)return {code:'REQUEST_TOO_LARGE'};
          if(size===0&&(operation==='create'||operation==='revoke'))return {body:{}};
          try { const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8')); return isObject(parsed)?{body:parsed}:{code:'REQUEST_INVALID'}; }
          catch{return {code:'REQUEST_INVALID'};}
        });
        if(!read.ok){fail(unavailableCode(operation));return;}
        if(read.value.code){fail(read.value.code);return;} body=read.value.body!;
      }
      if(operation==='create'&&Object.keys(body).length!==0){fail('REQUEST_INVALID');return;}
      if(operation==='revoke'&&Object.keys(body).some(key=>key!=='keyId')){fail('REQUEST_INVALID');return;}
      if(operation==='validate'&&body.apiKey!==undefined&&body.apiKey!==null&&body.apiKey!==''&&Object.keys(body).some(key=>!['apiKey','expectedTenantId','requestId'].includes(key))){fail('REQUEST_INVALID');return;}
      const result=await deps.coordinator.execute(operation,{session:session.value,context,body,keyId,attempt:attempt ?? undefined});
      if(!result.ok){fail(result.code);return;}
      if(!isActive(context)){fail(unavailableCode(operation));return;}
      send(operation==='create'?201:200,result.value);
    } catch { fail(operation?unavailableCode(operation):'REQUEST_INVALID'); }
    finally{if(requestContext)deps.coordinator.complete(attempt,completionCode,requestContext);dispose();}
  }
}
