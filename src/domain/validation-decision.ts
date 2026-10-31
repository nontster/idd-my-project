import type { Outcome } from './outcome';
import { isObject,isUuid,isTenantId } from './values';
export interface ValidationDecision { readonly keyId:string; readonly tenantId:string; readonly generation:number; readonly requestId:string; readonly decisionId:string; }
export function validationDecision(input:unknown):Outcome<ValidationDecision>{
  const unavailable={ok:false,code:'UNAVAILABLE'} as const;
  try{
    if(!isObject(input))return unavailable;
    const fields=['keyId','tenantId','generation','requestId','decisionId'];
    if(Object.keys(input).length!==5||Object.keys(input).some(key=>!fields.includes(key)))return unavailable;
    const value=Object.fromEntries(fields.map(field=>[field,input[field]]));
    if(!isUuid(value.keyId)||!isTenantId(value.tenantId)||!isUuid(value.requestId)||!isUuid(value.decisionId)||typeof value.generation!=='number'||!Number.isSafeInteger(value.generation)||value.generation<1)return unavailable;
    return {ok:true,value:Object.freeze(value) as unknown as ValidationDecision};
  }catch{return unavailable;}
}
