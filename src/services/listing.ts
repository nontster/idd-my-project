import type { ListingRepository } from '../ports/key-repository';
import type { VerifiedContext } from '../domain/identity';
import { withinContext,isActive,type RequestContext } from '../domain/request-context';
import { publicMetadata,type KeyMetadata } from '../domain/key-metadata';
import type { Outcome } from '../domain/outcome';
export interface KeyCollection{readonly items:readonly KeyMetadata[];}
export class ListingService{
  constructor(private readonly repository:ListingRepository){}
  async list(scope:VerifiedContext,context:RequestContext):Promise<Outcome<KeyCollection>>{
    const unavailable={ok:false,code:'E-14'} as const;
    try{
      const read=await withinContext(context,()=>this.repository.list(scope.tenantId));
      if(!read.ok||!read.value.ok||!Array.isArray(read.value.value)||!isActive(context))return unavailable;
      const items:KeyMetadata[]=[];
      for(const row of read.value.value){const checked=publicMetadata(row);if(!checked.ok||checked.value.tenantId!==scope.tenantId)return unavailable;items.push(checked.value);}
      return {ok:true,value:Object.freeze({items:Object.freeze(items)})};
    }catch{return unavailable;}
  }
}
