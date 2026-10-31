import type { Clock } from '../ports/clock';
import type { RequestContext } from '../domain/request-context';
import type { Outcome } from '../domain/outcome';
import { validationDecision,type ValidationDecision } from '../domain/validation-decision';
import { isActive,withinContext } from '../domain/request-context';
import { isUuid,isObject } from '../domain/values';
export interface ValidationRequest { apiKey:unknown; expectedTenantId:string; requestId:string; }
export interface AuthorityReply { status:number; body:unknown; }
export interface ValidationClient { validate(request:ValidationRequest,context:{signal:AbortSignal;remainingMs:number}):Promise<AuthorityReply>; }
export interface PendingAdmission { readonly requestId:string; readonly ready:Promise<void>; consume():Outcome<ValidationDecision>; cancel():void; }
export interface AdvisoryHint { readonly keyId:string; readonly tenantId:string; readonly generation:number; readonly status:'active'; }
const unavailable={ok:false,code:'E-10'} as const;
export class GatewayEnforcement {
  private readonly hints=new Map<string,AdvisoryHint>();
  constructor(private readonly client:ValidationClient,private readonly clock:Clock,private readonly identifier:()=>string,private readonly timeoutMs=500){
    if(!Number.isInteger(timeoutMs)||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Invalid gateway deadline');
  }
  begin(apiKey:unknown,tenantId:string,parent?:RequestContext):PendingAdmission{
    const controller=new AbortController();let requestId='';let deadline=0;let raw=apiKey;apiKey=undefined;
    try{
      const now=this.clock.monotonicNow();const remaining=parent?parent.deadline-parent.clock.monotonicNow():this.timeoutMs;
      deadline=now+Math.min(this.timeoutMs,remaining);requestId=this.identifier();
      if(!isUuid(requestId)||parent&&!isActive(parent))controller.abort();
    }catch{controller.abort();}
    const context:RequestContext={clock:this.clock,deadline,signal:controller.signal,identityTimeoutMs:100};
    const cancel=()=>controller.abort();parent?.signal.addEventListener('abort',cancel,{once:true});
    let consumed=false;let settled=false;let result:Outcome<ValidationDecision>=unavailable;
    const ready=(async()=>{
      try{
        const response=await withinContext(context,(signal,remainingMs)=>{
          const request:ValidationRequest={apiKey:raw,expectedTenantId:tenantId,requestId};raw=undefined;
          return this.client.validate(request,{signal,remainingMs});
        });
        if(consumed||!response.ok||!isActive(context)||parent&&!isActive(parent))return;
        const reply=response.value;
        if(reply.status===403&&isObject(reply.body)&&isObject(reply.body.error)&&reply.body.error.code==='E-07'){result={ok:false,code:'E-07'};return;}
        if(reply.status!==200)return;
        const decision=validationDecision(reply.body);
        if(decision.ok&&decision.value.requestId===requestId&&decision.value.tenantId===tenantId)result=decision;
      }catch{/* A protocol/transport failure never becomes a positive hint verdict. */}
      finally{raw=undefined;settled=true;parent?.signal.removeEventListener('abort',cancel);}
    })();
    return {requestId,ready,cancel,consume:()=>{
      if(consumed)return unavailable;consumed=true;
      if(!settled||!isActive(context)||parent&&!isActive(parent)){cancel();result=unavailable;return unavailable;}
      const outcome=result;result=unavailable;cancel();
      if(outcome.ok){const d=outcome.value;this.hints.set(d.keyId,Object.freeze({keyId:d.keyId,tenantId:d.tenantId,generation:d.generation,status:'active'}));}
      return outcome;
    }};
  }
  async admit(apiKey:unknown,tenantId:string,parent?:RequestContext):Promise<Outcome<ValidationDecision>>{const operation=this.begin(apiKey,tenantId,parent);await operation.ready;return operation.consume();}
  cacheEntries():readonly AdvisoryHint[]{return Object.freeze([...this.hints.values()]);}
}
