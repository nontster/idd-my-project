import type { DatabaseSync } from 'node:sqlite';
import { keyRecord } from '../../domain/key-record';
import { securityAttempt } from '../../domain/security-attempt';
import type { SecurityEventRepository } from '../../ports/security-event-repository';
import type { Clock } from '../../ports/clock';
import type { Outcome } from '../../domain/outcome';
export function recover(connection:DatabaseSync,events:SecurityEventRepository,clock:Clock):Outcome<void>{
  const unavailable={ok:false,code:'UNAVAILABLE'} as const;
  try{
    if(connection.isTransaction||connection.prepare('PRAGMA foreign_key_check').all().length>0)return unavailable;
    for(const row of connection.prepare('SELECT * FROM api_keys').iterate())if(!keyRecord(row).ok)return unavailable;
    for(const row of connection.prepare('SELECT * FROM security_attempts').iterate()){
      if(row.finalized!==0&&row.finalized!==1)return unavailable;
      if(!securityAttempt({...row,finalized:row.finalized===1}).ok)return unavailable;
    }
    const invalidCorrelation=connection.prepare("SELECT k.keyId FROM api_keys k JOIN security_attempts c ON c.attemptId=k.creationAttemptId LEFT JOIN security_attempts r ON r.attemptId=k.revocationAttemptId WHERE c.operation!='create' OR (k.revocationAttemptId IS NOT NULL AND r.operation!='revoke') LIMIT 1").get();
    if(invalidCorrelation)return unavailable;
    const pending=events.unfinished();if(!pending.ok)return unavailable;
    for(const attempt of pending.value){
      const rows=attempt.operation==='create'
        ?connection.prepare('SELECT * FROM api_keys WHERE creationAttemptId=?').all(attempt.attemptId)
        :connection.prepare('SELECT * FROM api_keys WHERE revocationAttemptId=?').all(attempt.attemptId);
      if(rows.length>1)return unavailable;
      const record=rows.length===1?keyRecord(rows[0]):null;
      if(record&&!record.ok)return unavailable;
      const known=record?.ok?record.value:null;
      const finalized=events.finalize({...attempt,tenantId:known?.tenantId??attempt.tenantId,keyId:known?.keyId??attempt.keyId,
        outcome:known?'succeeded':'failed',finalized:true,errorCode:known?null:attempt.operation==='create'?'E-08':'E-09',completedAt:clock.utcNow()});
      if(!finalized.ok)return unavailable;
    }
    return {ok:true,value:undefined};
  }catch{return unavailable;}
}
