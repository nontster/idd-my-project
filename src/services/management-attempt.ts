import type { AuthenticationService } from './authentication';
import type { Outcome } from '../domain/outcome';
import type { Principal } from '../domain/identity';
import type { RequestContext } from '../domain/request-context';
import { isActive } from '../domain/request-context';
import { publicError } from '../domain/errors';
import type { SecurityAttempt } from '../domain/security-attempt';
import type { SecurityEventRepository } from '../ports/security-event-repository';
export interface ManagedAttempt { value: SecurityAttempt; mutation?: 'committed' | 'not-committed' | 'uncertain'; }
export class ManagementAttempts {
  private available=true;
  private fail():void{this.available=false;try{this.emergency();}catch{/* A broken emergency sink cannot reopen management. */}}
  constructor(private readonly events:SecurityEventRepository,private readonly identifier:()=>string,private readonly emergency:()=>void){}
  begin(operation:'create'|'revoke',context:RequestContext):Outcome<ManagedAttempt>{
    if(!this.available)return {ok:false,code:'UNAVAILABLE'};
    try{
      const value:SecurityAttempt={attemptId:this.identifier(),operation,receivedAt:context.clock.utcNow(),callerId:null,tenantId:null,keyId:null,
        outcome:'unconfirmed',finalized:false,errorCode:null,completedAt:null};
      if(!this.events.begin(value).ok){this.fail();return {ok:false,code:'UNAVAILABLE'};}
      return {ok:true,value:{value}};
    }catch{this.fail();return {ok:false,code:'UNAVAILABLE'};}
  }
  complete(attempt:ManagedAttempt,code:string|null,context:RequestContext):boolean{
    if(attempt.value.finalized||attempt.mutation==='committed')return true;
    if(!this.available)return false;
    if(attempt.mutation==='uncertain'){this.fail();return false;}
    try{
      const safe=publicError(code).code;
      const rejected=/^E-(01|02|03|04|05|06|07|11|12|13|15|16)$/.test(safe)||['REQUEST_INVALID','REQUEST_TOO_LARGE','UNSUPPORTED_MEDIA_TYPE','NOT_FOUND','METHOD_NOT_ALLOWED'].includes(safe);
      const value:SecurityAttempt={...attempt.value,outcome:rejected?'rejected':'failed',finalized:true,errorCode:safe,completedAt:context.clock.utcNow()};
      if(!this.events.finalize(value).ok){this.fail();return false;}
      attempt.value=value;return true;
    }catch{this.fail();return false;}
  }
  committed(attempt:ManagedAttempt,keyId:string,context:RequestContext):void{
    const value:SecurityAttempt={...attempt.value,keyId,outcome:'succeeded',finalized:true,errorCode:null,completedAt:context.clock.utcNow()};
    if(!this.events.finalize(value).ok)throw new Error('Audit confirmation unavailable');
  }
}
export type Operation = 'create' | 'revoke' | 'validate' | 'list' | 'retrieve' | 'reactivate';
export interface Session { readonly principal: Principal; readonly tenantId?: string; }
export interface Invocation { readonly session: Session; readonly body: Record<string, unknown>; readonly keyId?: string; readonly context: RequestContext; readonly attempt?:ManagedAttempt; }
export type Handler = (input: Invocation) => Promise<Outcome<unknown>>;
export function unavailableCode(op: Operation): string {
  return ({ create:'E-08', revoke:'E-09', validate:'E-10', list:'E-14', retrieve:'OPERATION_UNAVAILABLE', reactivate:'OPERATION_UNAVAILABLE' })[op];
}
export class RequestCoordinator {
  constructor(private readonly auth: AuthenticationService, private readonly handlers: Partial<Record<Operation, Handler>> = {}, private readonly attempts?:ManagementAttempts) {}
  received(op:Operation,context:RequestContext):Outcome<ManagedAttempt|null>{
    return this.attempts&&(op==='create'||op==='revoke')?this.attempts.begin(op,context):{ok:true,value:null};
  }
  complete(attempt:ManagedAttempt|null,code:string|null,context:RequestContext):boolean{
    return attempt&&this.attempts?this.attempts.complete(attempt,code,context):true;
  }
  async preflight(op: Operation, credential: unknown, selector: unknown, context: RequestContext, attempt:ManagedAttempt|null=null): Promise<Outcome<Session>> {
    const caller = await this.auth.caller(credential, op === 'validate' ? 'validation' : 'management', context);
    if (!caller.ok) return { ok:false, code: caller.code === 'UNAVAILABLE' ? unavailableCode(op) : caller.code };
    if(attempt)attempt.value={...attempt.value,callerId:caller.value.subjectId};
    if (op === 'validate') return { ok:true, value: { principal: caller.value } };
    const scope = await this.auth.management(caller.value, selector, context);
    if(scope.ok&&attempt)attempt.value={...attempt.value,tenantId:scope.value.tenantId};
    return scope.ok ? scope : { ok:false, code: scope.code === 'UNAVAILABLE' ? unavailableCode(op) : scope.code };
  }
  async execute(op: Operation, input: Invocation): Promise<Outcome<unknown>> {
    if (!isActive(input.context)) return { ok:false, code:unavailableCode(op) };
    let invocation = input;
    if (op === 'validate') {
      if (input.body.apiKey === undefined || input.body.apiKey === null || input.body.apiKey === '') return {ok:false,code:'E-06'};
      const scope = await this.auth.validation(input.session.principal, input.body.expectedTenantId, input.body.requestId as string, input.context);
      if (!scope.ok) return {ok:false,code:scope.code === 'E-16' ? 'E-16' : 'E-10'};
      invocation = { ...input, session: scope.value };
    }
    const handler = this.handlers[op];
    if (!handler) return { ok:false, code:'NOT_IMPLEMENTED' };
    try {
      const result = await handler(invocation);
      return isActive(input.context) ? result : { ok:false,code:unavailableCode(op) };
    } catch { return { ok:false,code:unavailableCode(op) }; }
  }
}
