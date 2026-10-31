import { afterEach,expect,jest,test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { Server } from 'node:http';
import { dirname } from 'node:path';
import { createDevelopmentApplication,serviceHandlers } from '../../src/bootstrap/app';
import { run as developmentRun,development } from '../../src/bootstrap/development';
import { run as mainRun } from '../../src/bootstrap/main';
import { createIdentityFixtures,requestFixture } from '../support/identity-fixtures';
import { databaseFixture } from '../support/database-fixture';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { existsSync } from 'node:fs';
import fs = require('node:fs');
const originalExit=process.exitCode;
afterEach(()=>{jest.restoreAllMocks();process.exitCode=originalExit;});
test('composition handlers reject absent verified scope/receipt without invoking a business service',async()=>{
  let calls=0;const unavailable=async():Promise<never>=>{calls++;throw new Error('must not invoke');};const reject=():never=>{calls++;throw new Error('must not invoke');};
  const handlers=serviceHandlers({creation:{create:unavailable},listing:{list:unavailable},revocation:{revoke:unavailable},validation:{validate:unavailable},reactivation:{reject},retrieval:{reject}});
  const input={session:{principal:{kind:'developer',subjectId:'developer',trustedService:false} as const},body:{},context:requestFixture(2000).context};
  for(const [operation,code] of [['create','E-08'],['revoke','E-09'],['list','E-14'],['validate','E-10'],['reactivate','OPERATION_UNAVAILABLE'],['retrieve','OPERATION_UNAVAILABLE']] as const){const r=await handlers[operation](input);expect(r.ok?'SUCCESS':r.code).toBe(code);}
  for(const operation of ['create','revoke'] as const)expect((await handlers[operation]({...input,session:{...input.session,tenantId:'tenant-a'}})).ok).toBe(false);expect(calls).toBe(0);
});
test('development checks every listen signature and accepts only explicit loopback binding',async()=>{
  const db=databaseFixture();db.close();const options={databasePath:db.path,identityVerifier:createIdentityFixtures().verifier};
  const server=createDevelopmentApplication(options);
  try{
    expect(()=>server.listen(0)).toThrow('Development requires explicit loopback.');
    expect(()=>server.listen({port:0})).toThrow('Development requires explicit loopback.');
    expect(()=>server.listen(null as unknown as number)).toThrow('Development requires explicit loopback.');
    expect(()=>server.listen(0,'0.0.0.0')).toThrow('Development requires explicit loopback.');
    await new Promise<void>(done=>server.listen({port:0,host:'127.0.0.1'},done));const address=server.address();expect(address!==null&&typeof address!=='string').toBe(true);
    if(address&&typeof address!=='string')expect((await fetch(`http://127.0.0.1:${address.port}/health/ready`)).status).toBe(200);
  }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));db.cleanup();}
});
test('readiness denies native query failure and recording-media failure prevents authentication or mutation',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const original=DatabaseSync.prototype.prepare;const stderr:string[]=[];jest.spyOn(process.stderr,'write').mockImplementation(value=>{stderr.push(String(value));return true;});
  try{
    const probe=jest.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='SELECT 1')throw new Error('readiness medium unavailable');return original.call(this,sql);});
    const health=await fetch(app.url+'/health/ready');expect(health.status).toBe(503);expect(await health.json()).toEqual({ready:false});probe.mockRestore();
    const media=jest.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){if(sql.startsWith('INSERT INTO security_attempts'))throw new Error('audit medium unavailable');return original.call(this,sql);});
    const result=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);expect(result.status).toBe(503);expect(result.body.error.code).toBe('E-08');expect(ids.calls.authenticate).toBe(0);media.mockRestore();
    expect((await fetch(app.url+'/health/ready')).status).toBe(503);expect(stderr.every(line=>!line.includes(app.developerToken))).toBe(true);
    const later=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);expect(later.status).toBe(503);expect(later.body.error.code).toBe('E-08');expect(ids.calls.authenticate).toBe(0);
  }finally{await app.close();}
});
test('audit outcome medium failure cannot become a successful or secret-bearing HTTP reply',async()=>{
  const app=await startAcceptanceApp();const prepare=DatabaseSync.prototype.prepare;jest.spyOn(process.stderr,'write').mockImplementation(()=>true);
  const spy=jest.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){if(sql.startsWith('UPDATE security_attempts'))throw new Error('recording unavailable');return prepare.call(this,sql);});
  try{const response=await apiRequest(app.url,'/v1/api-keys','',{},app.tenantId);expect(response.status).toBe(503);expect(response.body.error.code).toBe('E-08');expect((await fetch(app.url+'/health/ready')).status).toBe(503);}
  finally{spy.mockRestore();await app.close();}
});
test('local credential-file failure cleans its temporary directory and refuses startup',()=>{
  const db=databaseFixture();db.close();const mkdir=fs.mkdtempSync;let created='';jest.spyOn(process.stderr,'write').mockImplementation(()=>true);
  jest.spyOn(fs,'mkdtempSync').mockImplementation((...args)=>{const directory=mkdir(...args);created=String(directory);return directory;});jest.spyOn(fs,'writeFileSync').mockImplementation(()=>{throw new Error('fixture volume unavailable');});
  try{expect(developmentRun({DATABASE_PATH:db.path,PORT:'0'},[])).toBe(null);expect(created.length>0&&!existsSync(created)).toBe(true);}finally{db.cleanup();}
});
test('asynchronous process binding errors are redacted and clean up owned local resources',async()=>{
  const db=databaseFixture();db.close();jest.spyOn(process.stdout,'write').mockImplementation(()=>true);jest.spyOn(process.stderr,'write').mockImplementation(()=>true);
  const first=developmentRun({DATABASE_PATH:db.path,PORT:'0'},[])!;
  try{
    await new Promise<void>(done=>first.server.listening?done():first.server.once('listening',done));const address=first.server.address();if(!address||typeof address==='string')throw new Error('Fixture listener unavailable');
    const local=developmentRun({DATABASE_PATH:db.path,PORT:String(address.port)},[])!;expect(local!==null).toBe(true);await new Promise<void>(done=>local.server.once('error',()=>done()));await new Promise<void>(done=>setImmediate(done));expect(existsSync(local.credentialFile)).toBe(false);
    const host=mainRun({DATABASE_PATH:db.path,PORT:String(address.port),IDENTITY_ADAPTER_MODULE:'host'},()=>({identityVerifier:{...createIdentityFixtures().verifier,mode:'host'}}))!;expect(host!==null).toBe(true);await new Promise<void>(done=>host.once('error',()=>done()));
  }finally{first.server.closeAllConnections();await new Promise<void>(done=>first.server.close(()=>done()));db.cleanup();}
});

test('local default host composition is still an actual loopback application',async()=>{
  const db=databaseFixture();db.close();const server=development({databasePath:db.path,identityVerifier:createIdentityFixtures().verifier});
  try{await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();expect(address!==null&&typeof address!=='string').toBe(true);}
  finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));db.cleanup();}
});
test('default process settings refuse absent authoritative storage and invalid port ranges safely',()=>{
  const db=databaseFixture();db.close();const cwd=process.cwd();const fields=['DATABASE_PATH','PORT','HOST','IDENTITY_ADAPTER_MODULE'] as const;const previous=new Map(fields.map(key=>[key,process.env[key]]));jest.spyOn(process.stderr,'write').mockImplementation(()=>true);
  try{
    process.chdir(dirname(db.path));for(const key of fields)delete process.env[key];
    expect(developmentRun()).toBe(null);expect(mainRun()).toBe(null);
    const host={...createIdentityFixtures().verifier,mode:'host'};
    expect(mainRun({IDENTITY_ADAPTER_MODULE:'host'},()=>({identityVerifier:host}))).toBe(null);
    for(const port of ['-1','65536','0.5']){expect(developmentRun({DATABASE_PATH:db.path,PORT:port},[])).toBe(null);expect(mainRun({DATABASE_PATH:db.path,PORT:port,IDENTITY_ADAPTER_MODULE:'host'},()=>({identityVerifier:host}))).toBe(null);}
  }finally{process.chdir(cwd);for(const [key,value] of previous)if(value===undefined)delete process.env[key];else process.env[key]=value;db.cleanup();}
});
test('unavailable listener address diagnostics never expose fixture credentials or change actual admission/readiness',async()=>{
  for(const unavailable of [null,'unavailable'] as const){
    const db=databaseFixture();db.close();const output:string[]=[];jest.spyOn(process.stdout,'write').mockImplementation(value=>{output.push(String(value));return true;});
    const address=Server.prototype.address;let running:ReturnType<typeof developmentRun>;
    const spy=jest.spyOn(Server.prototype,'address').mockImplementation(function(this:Server){return running?.server===this?unavailable:address.call(this);});
    running=developmentRun({DATABASE_PATH:db.path,PORT:'0'},[]);expect(running!==null).toBe(true);if(!running){spy.mockRestore();db.cleanup();continue;}
    try{
      await new Promise<void>(done=>running!.server.listening?done():running!.server.once('listening',done));spy.mockRestore();const actual=running.server.address();expect(actual!==null&&typeof actual!=='string').toBe(true);
      const credentials=fs.readFileSync(running.credentialFile,'utf8');const values=Object.values(JSON.parse(credentials) as Record<string,string>);expect(values.some(token=>output.some(line=>line.includes(token)))).toBe(false);
      if(actual&&typeof actual!=='string')expect((await fetch(`http://127.0.0.1:${actual.port}/health/ready`)).status).toBe(200);
    }finally{spy.mockRestore();running.server.closeAllConnections();await new Promise<void>(done=>running!.server.close(()=>done()));db.cleanup();}
  }
});

test('explicit default development initialization creates protected local storage before binding',async()=>{
  const db=databaseFixture();db.close();const cwd=process.cwd();jest.spyOn(process.stdout,'write').mockImplementation(()=>true);let running:ReturnType<typeof developmentRun>=null;
  try{
    process.chdir(dirname(db.path));expect(existsSync('.runtime')).toBe(false);
    running=developmentRun({PORT:'0'},['--initialize-fresh-store']);expect(running!==null).toBe(true);if(!running)return;
    await new Promise<void>(done=>running!.server.listening?done():running!.server.once('listening',done));
    expect(existsSync('.runtime/authority.sqlite')).toBe(true);expect(fs.statSync('.runtime').mode&0o777).toBe(0o700);
  }finally{if(running){running.server.closeAllConnections();await new Promise<void>(done=>running!.server.close(()=>done()));}process.chdir(cwd);db.cleanup();}
});
