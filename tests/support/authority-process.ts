import { DatabaseSync } from 'node:sqlite';
import { createDevelopmentApplication } from '../../src/bootstrap/app';
import { systemClock } from '../../src/adapters/clock/system-clock';
import { createIdentityFixtures } from './identity-fixtures';
process.once('message',(message:unknown)=>{
  try{
    const options=message as {path:string;crashAfterRevoke?:string};const identities=createIdentityFixtures();
    const observer=options.crashAfterRevoke?new DatabaseSync(options.path,{readOnly:true}):undefined;
    const clock={...systemClock,monotonicNow(){
      if(observer&&observer.prepare('SELECT status FROM api_keys WHERE keyId=?').get(options.crashAfterRevoke!)?.status==='revoked')process.kill(process.pid,'SIGKILL');
      return systemClock.monotonicNow();
    }};
    const server=createDevelopmentApplication({databasePath:options.path,identityVerifier:identities.verifier,host:'127.0.0.1',clock});
    server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Listener unavailable');
      process.send!({type:'ready',url:`http://127.0.0.1:${address.port}`,developerToken:identities.developerToken,serviceToken:identities.serviceToken});
    });
  }catch{process.send!({type:'failed',code:'STARTUP_UNAVAILABLE'});process.exitCode=1;process.disconnect();}
});
