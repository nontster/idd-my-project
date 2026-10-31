import type { ScopedKeyLookup } from '../ports/key-repository';
import type { VerifiedContext } from '../domain/identity';
import { isActive,type RequestContext } from '../domain/request-context';
import type { Outcome } from '../domain/outcome';
import { isUuid } from '../domain/values';
export class ReactivationRejection {
  constructor(private readonly lookup:ScopedKeyLookup){}
  reject(scope:VerifiedContext,keyId:unknown,context:RequestContext):Outcome<never>{
    const unavailable={ok:false,code:'OPERATION_UNAVAILABLE'} as const;
    try{
      if(!isActive(context))return unavailable;if(!isUuid(keyId))return {ok:false,code:'E-12'};
      const found=this.lookup.find(keyId,scope.tenantId);if(!found.ok||!isActive(context))return unavailable;
      if(!found.value)return {ok:false,code:'E-12'};
      if(found.value.status==='revoked')return {ok:false,code:'E-13'};
      return found.value.status==='active'?{ok:false,code:'E-15'}:unavailable;
    }catch{return unavailable;}
  }
}
