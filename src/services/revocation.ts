import type { RevocationRepository } from '../ports/key-repository';
import type { MutationUnitOfWork } from '../ports/mutation-unit-of-work';
import type { DecisionGate } from './decision-gate';
import type { VerifiedContext } from '../domain/identity';
import { isActive,withinContext,type RequestContext } from '../domain/request-context';
import { isUuid,isTenantId,isTimestamp } from '../domain/values';
import type { Outcome } from '../domain/outcome';
import type { ManagementAttempts,ManagedAttempt } from './management-attempt';
export interface RevokedKey { readonly keyId:string; readonly status:'revoked'; readonly revokedAt:string; }
export class RevocationService{
  constructor(private readonly repo:RevocationRepository,private readonly work:MutationUnitOfWork,private readonly gate:DecisionGate,private readonly attempts?:ManagementAttempts){}
  async revoke(scope:VerifiedContext,keyId:unknown,attemptId:string,context:RequestContext,attempt?:ManagedAttempt):Promise<Outcome<RevokedKey>>{
    const unavailable={ok:false,code:'E-09'} as const;
    if(scope.principal.kind!=='developer'||!isTenantId(scope.tenantId))return {ok:false,code:'E-04'};
    if(keyId===undefined||keyId===null||keyId==='')return {ok:false,code:'E-05'};
    if(!isUuid(keyId))return {ok:false,code:'E-12'};
    if(!isUuid(attemptId)||!isActive(context))return unavailable;
    if(this.attempts&&!attempt)return unavailable;
    if(attempt){
      if(attempt.value.attemptId!==attemptId||attempt.value.operation!=='revoke'||attempt.value.finalized)return unavailable;
      attempt.value={...attempt.value,callerId:scope.principal.subjectId,tenantId:scope.tenantId};
    }
    const waiting=await withinContext(context,()=>this.gate.run(context,()=>{
      const result=this.work.run<Outcome<RevokedKey>>(()=>{
        const row=this.repo.revoke(keyId,scope.tenantId,context.clock.utcNow(),attemptId);
        if(!row)return {ok:false,code:'E-12'};
        if(row.tenantId!==scope.tenantId||row.status!=='revoked'||row.generation!==2||!isTimestamp(row.revokedAt))throw new Error('Unconfirmed terminal state');
        if(attempt)attempt.value={...attempt.value,keyId:row.keyId};
        if(this.attempts)this.attempts.committed(attempt!,row.keyId,context);
        return {ok:true,value:Object.freeze({keyId:row.keyId,status:'revoked',revokedAt:row.revokedAt})};
      });
      if(attempt)attempt.mutation=result.kind==='committed'&&!result.value.ok?'not-committed':result.kind;
      return result;
    }));
    if(!waiting.ok||!waiting.value.ok||waiting.value.value.kind!=='committed'||!isActive(context))return unavailable;
    return waiting.value.value.value;
  }
}
