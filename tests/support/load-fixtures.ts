import { randomUUID,randomBytes } from 'node:crypto';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';
import { databaseFixture } from './database-fixture';
import { createIdentityFixtures } from './identity-fixtures';
export interface LoadKey{keyId:string;tenantId:string;apiKey:string;}
export function loadFixtures(){
  const db=databaseFixture();const crypto=new NodeKeyCryptography();const active:LoadKey[]=[];const revoked:LoadKey[]=[];const targets:LoadKey[]=[];
  const event=db.connection.prepare('INSERT INTO security_attempts (attemptId,operation,receivedAt,callerId,tenantId,keyId,outcome,finalized,errorCode,completedAt) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const key=db.connection.prepare('INSERT INTO api_keys (keyId,tenantId,prefix,salt,keyHash,status,generation,createdAt,revokedAt,creationAttemptId,revocationAttemptId) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const walAutoCheckpointPages=db.connection.prepare('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint;
  try{
    db.connection.exec('BEGIN IMMEDIATE');
    for(let tenant=0;tenant<1000;tenant++)for(let index=0;index<100;index++){
      const generated=crypto.generate();if(!generated.ok)throw new Error('Load fixture entropy unavailable');
      const material=generated.value;const keyId=randomUUID();const tenantId=`tenant-${tenant}`;const at=new Date().toISOString();const creationAttemptId=randomUUID();const isRevoked=index%10===0;const revocationAttemptId=isRevoked?randomUUID():null;
      event.run(creationAttemptId,'create',at,'load-developer',tenantId,keyId,'succeeded',1,null,at);
      if(revocationAttemptId)event.run(revocationAttemptId,'revoke',at,'load-developer',tenantId,keyId,'succeeded',1,null,at);
      key.run(keyId,tenantId,material.prefix,material.salt,material.keyHash,isRevoked?'revoked':'active',isRevoked?2:1,at,isRevoked?at:null,creationAttemptId,revocationAttemptId);
      const transient={keyId,tenantId,apiKey:material.apiKey};
      if(index===1)active.push(transient);if(index===0)revoked.push(transient);if(index===2&&tenant<360)targets.push(transient);
    }
    db.connection.exec('COMMIT');
    const count=db.connection.prepare('SELECT count(*) AS n,count(DISTINCT tenantId) AS tenants FROM api_keys').get();
    if(count?.n!==100000||count.tenants!==1000)throw new Error('Load fixture cardinality unavailable');
    db.close();
    const identities=createIdentityFixtures();const tenantKnown=(tenant:string)=>/^tenant-\d{1,3}$/.test(tenant)&&Number(tenant.slice(7))<1000;
    identities.verifier.authorizeManagement=async(principal,tenantId)=>{identities.calls.management++;return principal.kind==='developer'&&tenantKnown(tenantId)?{kind:'authorized',tenantId}:{kind:'denied'};};
    identities.verifier.establishValidationContext=async(principal,tenantId)=>{identities.calls.context++;return principal.kind==='service'&&principal.trustedService&&tenantKnown(tenantId)?{kind:'verified',tenantId}:{kind:'unavailable'};};
    return {db,active,revoked,targets,identities,walAutoCheckpointPages,unknown:()=>randomBytes(6).toString('base64url')+'.'+randomBytes(32).toString('base64url'),cleanup:()=>db.cleanup()};
  }catch{db.cleanup();throw new Error('Load fixture preparation failed');}
}
