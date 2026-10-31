import { expect,test } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { writeFileSync,mkdirSync } from 'node:fs';
import { cpus,release } from 'node:os';
import { startAcceptanceApp } from '../support/acceptance-app';
import { startGatewayServer } from '../support/gateway-servers';
import { loadFixtures,type LoadKey } from '../support/load-fixtures';
type Phase='baseline'|'warm'|'measure';
interface Attempt{phase:Phase;operation:'validation'|'revoke';expected:number;scheduled:number;sent:number;completed?:number;status?:number;correct?:boolean;transportFailure?:boolean;clientTimeout?:boolean;received?:number;finished?:number;serverStatus?:number;closedWithoutResponse?:boolean;}
function percentile(values:number[],percent:number){const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(sorted.length*percent/100)-1]:null;}
function distribution(values:number[]){return {samples:values.length,p95Ms:percentile(values,95),p99Ms:percentile(values,99),maxMs:values.length?Math.max(...values):null};}
test('100,000 salted records / 1,000 Tenants sustain fixed-arrival100 validations and1 revoke per second without post-R acceptance',async()=>{
  const fixture=loadFixtures();const app=await startAcceptanceApp({databasePath:fixture.db.path,initializeFreshStore:false},fixture.identities);const gateways=[await startGatewayServer(app),await startGatewayServer(app)];
  const attempts=new Map<string,Attempt>();const pending=new Set<Promise<void>>();let latestRevoked:LoadKey|undefined;let targetIndex=0;let sequence=0;let postRevocationAccepts=0;let unattributedReceived=0;let measuredOutstandingAtStop=0;
  app.server.prependListener('request',(request,response)=>{
    if(!['/v1/api-keys/validations','/v1/api-keys/revocations'].includes(request.url??''))return;
    const id=request.headers['x-load-id'];const entry=typeof id==='string'?attempts.get(id):undefined;if(!entry){unattributedReceived++;return;}
    entry.received=performance.now();response.once('finish',()=>{entry.finished=performance.now();entry.serverStatus=response.statusCode;});response.once('close',()=>{if(!response.writableFinished)entry.closedWithoutResponse=true;});
  });
  function offer(phase:Phase,operation:'validation'|'revoke',scheduled:number){
    const id=randomUUID();const index=operation==='validation'?sequence++:0;const tenant=Math.floor(index/10)%1000;const kind=index%10;
    let selected:LoadKey|undefined;let expected=200;let body:Record<string,unknown>;let url:string;const headers:Record<string,string>={'content-type':'application/json','x-load-id':id};
    if(operation==='revoke'){
      selected=fixture.targets[targetIndex++];if(!selected)throw new Error('Load revocation fixture exhausted');body={keyId:selected.keyId};url=app.url+'/v1/api-keys/revocations';headers.authorization=`Bearer ${app.developerToken}`;headers['x-tenant-id']=selected.tenantId;
    }else{
      const gateway=gateways[Math.floor(index/10)%2];url=gateway.url+'/admit';headers.authorization=`Bearer ${app.serviceToken}`;
      if(kind<5){selected=fixture.active[tenant];body={apiKey:selected.apiKey,expectedTenantId:selected.tenantId};}
      else if(kind<8){expected=403;body={apiKey:fixture.unknown(),expectedTenantId:`tenant-${tenant}`};}
      else if(kind===8){expected=403;selected=latestRevoked??fixture.revoked[tenant];body={apiKey:selected.apiKey,expectedTenantId:selected.tenantId};}
      else{expected=403;selected=fixture.active[(tenant+1)%1000];body={apiKey:selected.apiKey,expectedTenantId:`tenant-${tenant}`};}
    }
    const afterR=operation==='validation'&&kind===8&&selected===latestRevoked&&latestRevoked!==undefined;
    const entry:Attempt={phase,operation,expected,scheduled,sent:performance.now()};attempts.set(id,entry);const controller=new AbortController();const timer=setTimeout(()=>{entry.clientTimeout=true;controller.abort();},10000);timer.unref();
    const running=(async()=>{
      try{
        const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal});const payload=await response.json() as Record<string,unknown>;
        entry.status=response.status;entry.completed=performance.now();entry.correct=response.status===expected;
        if(operation==='validation'){
          if(expected===200)entry.correct=entry.correct&&payload.keyId===selected!.keyId&&payload.tenantId===selected!.tenantId;
          else entry.correct=entry.correct&&(payload.error as {code?:unknown}|undefined)?.code==='E-07';
          if(afterR&&response.status===200)postRevocationAccepts++;
        }else{
          entry.correct=entry.correct&&payload.keyId===selected!.keyId&&payload.status==='revoked';
          if(entry.correct)latestRevoked=selected;
        }
      }catch{entry.transportFailure=true;entry.completed=performance.now();entry.correct=false;}
      finally{clearTimeout(timer);}
    })();pending.add(running);void running.then(()=>pending.delete(running));
  }
  async function phase(name:Phase,seconds:number){
    const start=performance.now();const end=start+seconds*1000;let validation=0;let revokes=0;
    await new Promise<void>(done=>{
      const tick=()=>{
        const now=performance.now();while(validation<seconds*100&&start+validation*10<=now){offer(name,'validation',start+validation*10);validation++;}
        while(revokes<seconds&&start+revokes*1000<=now){offer(name,'revoke',start+revokes*1000);revokes++;}
        if(now>=end){done();return;}
        const next=Math.min(validation<seconds*100?start+validation*10:end,revokes<seconds?start+revokes*1000:end,end);setTimeout(tick,Math.max(0,next-performance.now()));
      };tick();
    });
    return performance.now()-start;
  }
  try{
    // Two real warmed HTTP gateways, independent of production creation.
    for(let index=0;index<2;index++){
      const id=randomUUID();const selected=fixture.active[0];attempts.set(id,{phase:'baseline',operation:'validation',expected:200,scheduled:performance.now(),sent:performance.now()});
      const r=await fetch(gateways[index].url+'/admit',{method:'POST',headers:{'content-type':'application/json','x-load-id':id},body:JSON.stringify({apiKey:selected.apiKey,expectedTenantId:selected.tenantId})});expect(r.status).toBe(200);await r.arrayBuffer();expect(gateways[index].cacheSize()>0).toBe(true);
    }
    process.stdout.write('{"loadStage":"warm","seconds":60,"validationsPerSecond":100,"revocationsPerSecond":1}\n');
    const warmElapsedMs=await phase('warm',60);await Promise.all([...pending]);
    process.stdout.write('{"loadStage":"measure","seconds":300,"validationsPerSecond":100,"revocationsPerSecond":1}\n');
    const progress=setInterval(()=>{const rows=[...attempts.values()].filter(row=>row.phase==='measure');process.stdout.write(JSON.stringify({loadStage:'measure-progress',offered:rows.length,completed:rows.filter(row=>row.completed!==undefined).length})+'\n');},30000);progress.unref();
    let measurementElapsedMs:number;try{measurementElapsedMs=await phase('measure',300);}finally{clearInterval(progress);}
    measuredOutstandingAtStop=[...attempts.values()].filter(row=>row.phase==='measure'&&row.completed===undefined).length;await Promise.all([...pending]);
    const measured=[...attempts.values()].filter(row=>row.phase==='measure');const validation=measured.filter(row=>row.operation==='validation');const revoke=measured.filter(row=>row.operation==='revoke');
    function accounting(rows:Attempt[]){return {offered:rows.length,completed:rows.filter(row=>row.completed!==undefined&&!row.transportFailure).length,transportFailures:rows.filter(row=>row.transportFailure).length,timeouts:rows.filter(row=>row.clientTimeout).length,cancellations:0,outstanding:rows.filter(row=>row.completed===undefined).length,incorrectOutcomes:rows.filter(row=>!row.correct).length,received:rows.filter(row=>row.received!==undefined).length,completedAuthorityResponses:rows.filter(row=>row.finished!==undefined).length,receivedWithoutResponse:rows.filter(row=>row.received!==undefined&&row.finished===undefined).length,unavailableResponses:rows.filter(row=>row.status===503).length};}
    const authorityValidation=validation.filter(row=>row.received!==undefined&&row.finished!==undefined).map(row=>row.finished!-row.received!);const authorityRevoke=revoke.filter(row=>row.status===200&&row.received!==undefined&&row.finished!==undefined).map(row=>row.finished!-row.received!);
    const endToEnd=validation.filter(row=>row.completed!==undefined&&!row.transportFailure).map(row=>row.completed!-row.scheduled);
    const report={dataset:{keys:100000,tenants:1000},configuration:{gatewayValidationTimeoutMs:500,validationTimeoutMs:200,identityTimeoutMs:100,managementTimeoutMs:2000,automaticRetries:0,sqliteBusyTimeoutMs:0,sqliteSynchronous:'FULL',walAutoCheckpointPages:fixture.walAutoCheckpointPages},runtime:{node:process.version,platform:process.platform,arch:process.arch,osRelease:release(),cpu:cpus()[0]?.model,cpuCount:cpus().length},warmElapsedMs,measurementElapsedMs,validation:accounting(validation),revocation:accounting(revoke),warmFailures:[...attempts.values()].filter(row=>row.phase==='warm'&&!row.correct).length,acceptedValidations:validation.filter(row=>row.status===200).length,rejectedValidations:validation.filter(row=>row.status===403).length,successfulRevocations:revoke.filter(row=>row.status===200).length,unsuccessfulOrUnconfirmedRevocations:revoke.filter(row=>row.status!==200).length,authorityValidation:distribution(authorityValidation),authoritySuccessfulRevocation:distribution(authorityRevoke),scheduledGatewayEndToEnd:distribution(endToEnd),postRevocationAccepts,unattributedReceived,measuredOutstandingAtStop,measurement:'authority request event to response finish; gateway end-to-end from scheduled arrival; no durations invented for missing responses'};
    mkdirSync('.superpowers/sdd/tasks',{recursive:true});writeFileSync('.superpowers/sdd/tasks/load-latest.json',JSON.stringify(report,null,2)+'\n');
    expect(report.warmFailures).toBe(0);expect(report.validation.offered).toBe(30000);expect(report.revocation.offered).toBe(300);expect(report.validation.incorrectOutcomes).toBe(0);expect(report.revocation.incorrectOutcomes).toBe(0);
    expect(report.acceptedValidations).toBe(15000);expect(report.rejectedValidations).toBe(15000);expect(report.successfulRevocations).toBe(300);expect(report.unsuccessfulOrUnconfirmedRevocations).toBe(0);expect(report.validation.receivedWithoutResponse+report.revocation.receivedWithoutResponse).toBe(0);expect(report.validation.outstanding+report.revocation.outstanding).toBe(0);expect(report.postRevocationAccepts).toBe(0);expect(report.unattributedReceived).toBe(0);
    expect(authorityValidation.length).toBe(30000);expect(authorityRevoke.length).toBe(300);expect(report.authorityValidation.p95Ms!).toBeLessThanOrEqual(100);expect(report.authorityValidation.p99Ms!).toBeLessThanOrEqual(250);expect(report.authoritySuccessfulRevocation.p95Ms!).toBeLessThanOrEqual(1000);expect(report.authoritySuccessfulRevocation.p99Ms!).toBeLessThanOrEqual(2000);
    expect(report.scheduledGatewayEndToEnd.p95Ms!).toBeLessThanOrEqual(100);expect(report.scheduledGatewayEndToEnd.p99Ms!).toBeLessThanOrEqual(250);
    process.stdout.write(JSON.stringify({loadStage:'complete',correct:true,validationP95Ms:report.authorityValidation.p95Ms,validationP99Ms:report.authorityValidation.p99Ms,revokeP95Ms:report.authoritySuccessfulRevocation.p95Ms,revokeP99Ms:report.authoritySuccessfulRevocation.p99Ms,postRevocationAccepts})+'\n');
  }finally{for(const gateway of gateways)await gateway.close();await app.close();fixture.cleanup();}
},480000);
