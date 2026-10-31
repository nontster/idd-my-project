import { expect,test } from '@jest/globals';
import { ListingService } from '../../src/services/listing';
import { SqliteListingRepository } from '../../src/adapters/sqlite/listing-repository';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture,deferred } from '../support/identity-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-colleague',trustedService:false},tenantId:'tenant-a'} as const;
test('listing returns explicit safe metadata from a complete repository result only',async()=>{
  const seed=sampleKeyRecord();const service=new ListingService({list:()=>({ok:true,value:[seed.record]})});
  const result=await service.list(scope,requestFixture(2000).context);expect(result.ok).toBe(true);
  if(result.ok){expect(Object.keys(result.value.items[0]).sort()).toEqual(['createdAt','keyId','prefix','revokedAt','status','tenantId']);expect(JSON.stringify(result.value).includes(seed.apiKey)).toBe(false);}
  for(const list of [()=>({ok:false as const,code:'UNAVAILABLE'}),()=>({ok:true as const,value:[{...seed.record,tenantId:'tenant-b'}]}),()=>({ok:true as const,value:[{...seed.record,status:'invalid'}] as unknown as typeof seed.record[]}),()=>{throw new Error('read unavailable');}])expect((await new ListingService({list}).list(scope,requestFixture(2000).context) as {code:string}).code).toBe('E-14');
});
test('cancellation stops waiting on a delayed real SQL read and ignores its late complete result with no retry',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const native=new SqliteListingRepository(db.connection);const started=deferred();const release=deferred();let calls=0;const f=requestFixture(2000);
  const service=new ListingService({async list(tenantId){calls++;const result=native.list(tenantId);started.resolve();await release.promise;return result;}});
  const pending=service.list(scope,f.context);
  try{const first=await Promise.race([started.promise.then(()=>'read'),pending.then(()=>'result')]);expect(first).toBe('read');f.controller.abort();expect((await pending as {code:string}).code).toBe('E-14');release.resolve();expect(calls).toBe(1);}
  finally{release.resolve();db.cleanup();}
});
