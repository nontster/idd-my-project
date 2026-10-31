import { createDevelopmentApplication,type ApplicationOptions } from './app';
import type { Server } from 'node:http';
import { mkdtempSync,writeFileSync,rmSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentityFixtures } from '../../tests/support/identity-fixtures';
import { gracefulShutdown } from './process-lifecycle';
export function development(options:ApplicationOptions){return createDevelopmentApplication({...options,host:options.host??'127.0.0.1'});}
export function run(env:NodeJS.ProcessEnv=process.env,args:readonly string[]=process.argv.slice(2)):{server:Server;credentialFile:string}|null{
  let directory:string|undefined;let server:Server|undefined;
  try{
    const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid local port');
    const identities=createIdentityFixtures();
    if(env.DATABASE_PATH===undefined&&args.includes('--initialize-fresh-store'))mkdirSync('.runtime',{recursive:true,mode:0o700});
    server=development({databasePath:env.DATABASE_PATH??'.runtime/authority.sqlite',identityVerifier:identities.verifier,
      host:env.HOST??'127.0.0.1',initializeFreshStore:args.includes('--initialize-fresh-store')});
    directory=mkdtempSync(join(tmpdir(),'api-key-development-'));const credentialFile=join(directory,'fixture-credentials.json');
    const credentials={tenantADeveloper:identities.developerToken,tenantAColleague:identities.colleagueToken,tenantBDeveloper:identities.tenantBDeveloperToken,trustedService:identities.serviceToken};
    writeFileSync(credentialFile,JSON.stringify(credentials),{mode:0o600,flag:'wx'});
    const ownedDirectory=directory;server.once('close',()=>rmSync(ownedDirectory,{recursive:true,force:true}));
    gracefulShutdown(server);
    server.once('error',()=>{process.stderr.write('{"ready":false,"code":"BOOTSTRAP_UNAVAILABLE"}\n');process.exitCode=1;server!.close();});
    const listening=server;server.listen(port,env.HOST??'127.0.0.1',()=>{
      const address=listening.address();
      process.stdout.write(JSON.stringify({ready:true,credentialFile,port:typeof address==='object'&&address!==null?address.port:port})+'\n');
    });
    return {server,credentialFile};
  }catch{
    server?.close();if(directory)rmSync(directory,{recursive:true,force:true});
    process.stderr.write('{"ready":false,"code":"BOOTSTRAP_UNAVAILABLE"}\n');process.exitCode=1;return null;
  }
}
