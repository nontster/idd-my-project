import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/adapters/sqlite/database';
import { SqliteSecurityEvents } from '../../src/adapters/sqlite/security-events';
import { randomUUID } from 'node:crypto';
import type { SecurityAttempt } from '../../src/domain/security-attempt';
export function databaseFixture(){
  const directory=mkdtempSync(join(tmpdir(),'key-story-'));const path=join(directory,'authority.sqlite');
  const opened=openDatabase({path,initializeFreshStore:true});if(!opened.ok)throw new Error('Fixture storage unavailable');
  const events=new SqliteSecurityEvents(opened.value.connection);
  function attempt(operation:'create'|'revoke'='create'):SecurityAttempt{
    const value:SecurityAttempt={attemptId:randomUUID(),operation,receivedAt:new Date().toISOString(),callerId:null,tenantId:null,keyId:null,outcome:'unconfirmed',finalized:false,errorCode:null,completedAt:null};
    if(!events.begin(value).ok)throw new Error('Fixture attempt unavailable');return value;
  }
  return {...opened.value,path,events,attempt,cleanup(){opened.value.close();rmSync(directory,{recursive:true,force:true});}};
}
