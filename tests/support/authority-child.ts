import { fork } from 'node:child_process';
import { join } from 'node:path';
export async function authorityChild(path:string,crashAfterRevoke?:string){
  const child=fork(join(__dirname,'authority-process.js'),[],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']});child.stdout?.resume();child.stderr?.resume();
  const exited=new Promise<void>(done=>child.once('exit',()=>done()));
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;};
  const ready=new Promise<{url:string;developerToken:string;serviceToken:string}>((resolve,reject)=>{
    child.once('error',()=>reject(new Error('Authority fixture failed to start')));
    child.once('exit',()=>reject(new Error('Authority fixture exited before readiness')));
    child.once('message',(value:unknown)=>{const result=value as Record<string,unknown>;
      if(result.type==='ready'&&typeof result.url==='string'&&typeof result.developerToken==='string'&&typeof result.serviceToken==='string')resolve(result as {url:string;developerToken:string;serviceToken:string});
      else reject(new Error('Authority fixture refused startup'));
    });
  });
  child.send({path,crashAfterRevoke});
  try{return {...await ready,exited,stop};}catch(error){await stop();throw error;}
}
