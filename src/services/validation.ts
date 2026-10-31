import type { ValidationRepository } from '../ports/key-repository';
import type { KeyCryptography } from '../ports/key-cryptography';
import type { DecisionGate } from './decision-gate';
import type { VerifiedContext } from '../domain/identity';
import type { RequestContext } from '../domain/request-context';
import { validationDecision, type ValidationDecision } from '../domain/validation-decision';
import { isActive,withinContext } from '../domain/request-context';
import { isUuid,isTenantId } from '../domain/values';
import type { KeyRecord } from '../domain/key-record';
import type { Outcome } from '../domain/outcome';
export class ValidationService {
  constructor(private readonly repo:ValidationRepository,private readonly crypto:KeyCryptography,private readonly gate:DecisionGate,private readonly identifier:()=>string){}
  async validate(scope:VerifiedContext,apiKey:unknown,requestId:string,context:RequestContext):Promise<Outcome<ValidationDecision>>{
    const unavailable={ok:false,code:'E-10'} as const;
    try{
      if(scope.principal.kind!=='service'||!scope.principal.trustedService)return {ok:false,code:'E-16'};
      if(apiKey===undefined||apiKey===null||apiKey==='')return {ok:false,code:'E-06'};
      if(!isActive(context)||!isUuid(requestId)||!isTenantId(scope.tenantId))return unavailable;
      const prefix=this.crypto.prefix(apiKey);if(!prefix)return {ok:false,code:'E-07'};
      const candidates=this.repo.candidates(scope.tenantId,prefix);if(!candidates.ok)return unavailable;
      let matched:KeyRecord|null=null;
      for(const candidate of candidates.value){
        const comparison=this.crypto.verify(apiKey,candidate.salt,candidate.keyHash);if(!comparison.ok)return unavailable;
        if(comparison.value){if(matched)return unavailable;matched=candidate;}
      }
      if(!matched)return {ok:false,code:'E-07'};
      const keyId=matched.keyId;
      const waiting=await withinContext(context,()=>this.gate.run(context,():Outcome<ValidationDecision>=>{
        const current=this.repo.current(keyId,scope.tenantId);if(!current.ok)return unavailable;
        if(!current.value||current.value.tenantId!==scope.tenantId||current.value.status!=='active')return {ok:false,code:'E-07'};
        const decision=validationDecision({keyId:current.value.keyId,tenantId:current.value.tenantId,generation:current.value.generation,requestId,decisionId:this.identifier()});
        return decision.ok?decision:unavailable;
      }));
      const gated=waiting.ok?waiting.value:null;
      return gated?.ok&&isActive(context)?gated.value:unavailable;
    }catch{return unavailable;}
  }
}
