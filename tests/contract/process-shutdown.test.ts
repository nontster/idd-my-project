import { expect,test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { existsSync,rmSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { databaseFixture } from '../support/database-fixture';
test('a local process removes its protected fixture credential file on normal SIGTERM shutdown',async()=>{
  const db=databaseFixture();db.close();const entry=resolve(__dirname,'../../src/bootstrap/development.js');
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(entry)}).run(process.env,[])`],{env:{...process.env,DATABASE_PATH:db.path,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr.resume();let credentialFile='';
  const exited=new Promise<void>(done=>child.once('exit',()=>done()));
  const ready=new Promise<void>((done,reject)=>{let text='';child.once('error',()=>reject(new Error('Shutdown fixture failed to start')));child.once('exit',()=>reject(new Error('Shutdown fixture exited before readiness')));child.stdout.on('data',chunk=>{text+=String(chunk);for(const line of text.split('\n'))try{const value=JSON.parse(line) as {ready?:boolean;credentialFile?:string};if(value.ready&&value.credentialFile){credentialFile=value.credentialFile;done();}}catch{/* incomplete metadata line */}});});
  try{await ready;expect(existsSync(credentialFile)).toBe(true);child.kill('SIGTERM');await exited;expect(existsSync(credentialFile)).toBe(false);}
  finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;if(credentialFile&&dirname(credentialFile).includes('api-key-development-'))rmSync(dirname(credentialFile),{recursive:true,force:true});db.cleanup();}
},15000);

test('explicit first start creates default local storage in a clean working directory',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'api-key-clean-start-'));const entry=resolve(__dirname,'../../src/bootstrap/development.js');
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(entry)}).run(process.env,['--initialize-fresh-store'])`],{cwd:directory,env:{PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr.resume();
  const exited=new Promise<void>(done=>child.once('exit',()=>done()));
  const ready=new Promise<boolean>(done=>{let text='';child.once('error',()=>done(false));child.once('exit',()=>done(false));child.stdout.on('data',chunk=>{text+=String(chunk);for(const line of text.split('\n'))try{if(JSON.parse(line).ready)done(true);}catch{/* readiness metadata only */}});});
  try{expect(await ready).toBe(true);expect(existsSync(resolve(directory,'.runtime/authority.sqlite'))).toBe(true);}
  finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited;rmSync(directory,{recursive:true,force:true});}
},15000);
