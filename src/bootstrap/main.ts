import { resolve } from 'node:path';
import { createApplication,type ApplicationOptions } from './app';
import { gracefulShutdown } from './process-lifecycle';
export function main(options:ApplicationOptions){return createApplication(options);}
export function run(env:NodeJS.ProcessEnv=process.env,load:(path:string)=>unknown=path=>require(resolve(path))):ReturnType<typeof main>|null{
  try{
    const adapter=env.IDENTITY_ADAPTER_MODULE;if(!adapter)throw new Error('Host identity required');
    const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
    const module=load(adapter) as {identityVerifier?:unknown};
    const server=main({databasePath:env.DATABASE_PATH??'.runtime/authority.sqlite',identityVerifier:module.identityVerifier,restoredFromBackup:env.RESTORED_FROM_BACKUP!==undefined});
    gracefulShutdown(server);
    server.once('error',()=>{process.stderr.write('{"ready":false,"code":"BOOTSTRAP_UNAVAILABLE"}\n');process.exitCode=1;server.close();});
    server.listen(port,'127.0.0.1');return server;
  }catch{process.stderr.write('{"ready":false,"code":"BOOTSTRAP_UNAVAILABLE"}\n');process.exitCode=1;return null;}
}
