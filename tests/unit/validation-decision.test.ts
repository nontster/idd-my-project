import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { validationDecision } from '../../src/domain/validation-decision';
function valid(){return {keyId:randomUUID(),tenantId:'tenant-a',generation:1,requestId:randomUUID(),decisionId:randomUUID()};}
test('a decision contains exactly immutable request-bound non-secret fields',()=>{
  const input=valid();const result=validationDecision(input);expect(result.ok).toBe(true);
  if(result.ok){expect(Object.keys(result.value).sort()).toEqual(['decisionId','generation','keyId','requestId','tenantId']);expect(Object.isFrozen(result.value)).toBe(true);expect(result.value.requestId).toBe(input.requestId);}
});
test.each(['keyId','requestId','decisionId','tenantId','generation'] as const)('invalid %s never creates a positive decision',field=>{
  for(const bad of [null,undefined,'',0,-1,Infinity,{},[]])expect(validationDecision({...valid(),[field]:bad}).ok).toBe(false);
});
test('extra secret/capability fields, missing objects and hostile accessors cannot enter a decision',()=>{
  for(const input of [null,undefined,[],{}, {...valid(),apiKey:randomUUID()}, {...valid(),get generation(){throw new Error('invalid accessor');}}])expect(validationDecision(input).ok).toBe(false);
});
