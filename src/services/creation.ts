import type { CreationRepository } from '../ports/key-repository';
import type { KeyCryptography } from '../ports/key-cryptography';
import type { MutationUnitOfWork } from '../ports/mutation-unit-of-work';
import type { DecisionGate } from './decision-gate';
import type { VerifiedContext } from '../domain/identity';
import type { RequestContext } from '../domain/request-context';
import { createdKey, type CreatedKey } from '../domain/key-dtos';
import { keyRecord } from '../domain/key-record';
import { isActive,withinContext } from '../domain/request-context';
import { isUuid, isTenantId } from '../domain/values';
import type { ManagedAttempt, ManagementAttempts } from './management-attempt';
import type { Outcome } from '../domain/outcome';
export class CreationService {
  constructor(private readonly repo:CreationRepository,private readonly crypto:KeyCryptography,private readonly work:MutationUnitOfWork,private readonly gate:DecisionGate,private readonly identifier:()=>string,private readonly attempts?:ManagementAttempts){}
  async create(scope:VerifiedContext,attemptId:string,context:RequestContext,attempt?:ManagedAttempt):Promise<Outcome<CreatedKey>>{
    const unavailable={ok:false,code:'E-08'} as const;
    if(scope.principal.kind!=='developer'||!isTenantId(scope.tenantId)||!isUuid(attemptId)||!isActive(context))return unavailable;
    if(this.attempts&&!attempt)return unavailable;
    if(attempt){
      if(attempt.value.attemptId!==attemptId||attempt.value.operation!=='create'||attempt.value.finalized)return unavailable;
      attempt.value={...attempt.value,callerId:scope.principal.subjectId,tenantId:scope.tenantId};
    }
    const waiting=await withinContext(context,()=>this.gate.run(context,()=>{
      const outcome=this.work.run(()=>{
      for(let candidate=0;candidate<8;candidate++){
        if(!isActive(context))throw new Error('request unavailable');
        const generated=this.crypto.generate();if(!generated.ok)throw new Error('generation unavailable');
        const material=generated.value;
        const retained=this.repo.retainedCandidates(material.prefix);if(!retained.ok)throw new Error('history unavailable');
        let reused=false;
        for(const old of retained.value){
          const match=this.crypto.verify(material.apiKey,old.salt,old.keyHash);if(!match.ok)throw new Error('verification unavailable');
          reused=match.value||reused;
        }
        if(reused)continue;
        const record=keyRecord({keyId:this.identifier(),tenantId:scope.tenantId,prefix:material.prefix,salt:material.salt,keyHash:material.keyHash,
          status:'active',generation:1,createdAt:context.clock.utcNow(),revokedAt:null,creationAttemptId:attemptId,revocationAttemptId:null});
        if(!record.ok||!isActive(context))throw new Error('record unavailable');
        this.repo.insert(record.value);
        if(this.attempts)this.attempts.committed(attempt!,record.value.keyId,context);
        return {record:record.value,apiKey:material.apiKey};
      }
      throw new Error('candidate budget exhausted');
      });
      if(attempt)attempt.mutation=outcome.kind;
      return outcome;
    }));
    const gated=waiting.ok?waiting.value:null;
    if(!gated?.ok||gated.value.kind!=='committed'||!isActive(context))return unavailable;
    return {ok:true,value:createdKey(gated.value.value.record,gated.value.value.apiKey)};
  }
}
