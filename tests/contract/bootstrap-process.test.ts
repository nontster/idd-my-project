import { afterEach,expect,jest,test } from '@jest/globals';
import { readFileSync,statSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { run as developmentRun,development } from '../../src/bootstrap/development';
import { run as mainRun,main } from '../../src/bootstrap/main';
import { databaseFixture } from '../support/database-fixture';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { createApplication } from '../../src/bootstrap/app';
import type { Server } from 'node:http';
const initialExit=process.exitCode;
afterEach(()=>{process.exitCode=initialExit;jest.restoreAllMocks();});
async function close(server:Server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
test('explicit local startup uses a durable store, ephemeral protected fixture file, and actual loopback HTTP without logging credentials',async()=>{
  const db=databaseFixture();db.close();const logs:string[]=[];jest.spyOn(process.stdout,'write').mockImplementation(value=>{logs.push(String(value));return true;});
  const running=developmentRun({DATABASE_PATH:db.path,PORT:'0',HOST:'127.0.0.1'},[]);expect(running!==null).toBe(true);
  if(!running){db.cleanup();return;}
  try{
    await new Promise<void>(done=>running.server.listening?done():running.server.once('listening',done));
    expect(statSync(running.credentialFile).mode&0o777).toBe(0o600);const credentials=JSON.parse(readFileSync(running.credentialFile,'utf8')) as Record<string,string>;
    expect(typeof credentials.tenantADeveloper==='string'&&typeof credentials.tenantBDeveloper==='string'&&typeof credentials.trustedService==='string').toBe(true);
    expect(Object.values(credentials).some(token=>logs.some(line=>line.includes(token)))).toBe(false);
    const address=running.server.address();expect(address!==null&&typeof address!=='string'&&address.address==='127.0.0.1').toBe(true);
    if(!address||typeof address==='string')return;const url=`http://127.0.0.1:${address.port}`;
    const ready=await fetch(url+'/health/ready');expect(ready.status).toBe(200);
    const listing=await fetch(url+'/v1/api-keys',{headers:{authorization:`Bearer ${credentials.tenantBDeveloper}`,'x-tenant-id':'tenant-b'}});expect(listing.status).toBe(200);
    const forbidden=await fetch(url+'/v1/api-keys',{headers:{authorization:`Bearer ${credentials.tenantBDeveloper}`,'x-tenant-id':'tenant-a'}});expect(forbidden.status).toBe(403);
  }finally{await close(running.server);expect(existsSync(running.credentialFile)).toBe(false);db.cleanup();}
});
test('local process requires explicit fresh initialization and refuses unsafe binding or invalid port without secret diagnostics',()=>{
  const db=databaseFixture();db.close();const output:string[]=[];jest.spyOn(process.stderr,'write').mockImplementation(value=>{output.push(String(value));return true;});
  try{
    expect(developmentRun({DATABASE_PATH:join(db.path,'..','missing.sqlite'),PORT:'0'},[])).toBe(null);
    expect(developmentRun({DATABASE_PATH:db.path,PORT:'invalid'},[])).toBe(null);
    expect(developmentRun({DATABASE_PATH:db.path,HOST:'0.0.0.0',PORT:'0'},[])).toBe(null);
    expect(output.length).toBe(3);expect(output.every(line=>line.includes('BOOTSTRAP_UNAVAILABLE'))).toBe(true);
  }finally{db.cleanup();}
});
test('normal process starts only with an explicit host verifier and existing durable authority',async()=>{
  const db=databaseFixture();db.close();const ids=createIdentityFixtures();const host={...ids.verifier,mode:'host'};
  const server=mainRun({DATABASE_PATH:db.path,PORT:'0',IDENTITY_ADAPTER_MODULE:'host-module'},()=>({identityVerifier:host}));expect(server!==null).toBe(true);
  if(!server){db.cleanup();return;}
  try{await new Promise<void>(done=>server.listening?done():server.once('listening',done));const address=server.address();expect(address!==null&&typeof address!=='string').toBe(true);}
  finally{await close(server);db.cleanup();}
});
test('normal process errors stay redacted and production cannot initialize a fresh store through the local-only flag',async()=>{
  const db=databaseFixture();db.close();const ids=createIdentityFixtures();const output:string[]=[];jest.spyOn(process.stderr,'write').mockImplementation(value=>{output.push(String(value));return true;});
  try{
    expect(mainRun({})).toBe(null);expect(mainRun({IDENTITY_ADAPTER_MODULE:join(db.path,'..','missing.cjs')})).toBe(null);
    expect(mainRun({IDENTITY_ADAPTER_MODULE:'host',PORT:'invalid'},()=>({identityVerifier:{...ids.verifier,mode:'host'}}))).toBe(null);
    let code='NO_FAILURE';let server:Server|undefined;try{server=createApplication({databasePath:join(db.path,'..','fresh.sqlite'),initializeFreshStore:true,identityVerifier:{...ids.verifier,mode:'host'}});}catch(error){code=(error as {code:string}).code;}
    if(server)await close(server);expect(code).toBe('INVALID_CONFIGURATION');expect(output.every(line=>line.includes('BOOTSTRAP_UNAVAILABLE'))).toBe(true);
  }finally{db.cleanup();}
});
