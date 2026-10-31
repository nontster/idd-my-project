import type { ScopedKeyLookup } from '../ports/key-repository';
import type { VerifiedContext } from '../domain/identity';
import { isActive, type RequestContext } from '../domain/request-context';
import type { Outcome } from '../domain/outcome';
import { isUuid } from '../domain/values';
export class SecretRetrieval {
  constructor(private readonly lookup:ScopedKeyLookup){}
  reject(scope:VerifiedContext,keyId:unknown,context:RequestContext):Outcome<never>{
    try{
      if(!isActive(context))return {ok:false,code:'OPERATION_UNAVAILABLE'};
      if(!isUuid(keyId))return {ok:false,code:'E-12'};
      const found=this.lookup.find(keyId,scope.tenantId);
      if(!found.ok||!isActive(context))return {ok:false,code:'OPERATION_UNAVAILABLE'};
      return {ok:false,code:found.value?'E-11':'E-12'};
    }catch{return {ok:false,code:'OPERATION_UNAVAILABLE'};}
  }
}
