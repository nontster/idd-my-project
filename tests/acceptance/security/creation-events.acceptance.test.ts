import { expect,test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
test('received rejected creation attempts durably preserve explicit unknown identity without credentials',async()=>{
  const app=await startAcceptanceApp();try{
    const response=await apiRequest(app.url,'/v1/api-keys','',{},app.tenantId);expect(response.status).toBe(401);
    const db=new DatabaseSync(app.databasePath);try{
      const rows=db.prepare('SELECT * FROM security_attempts').all();expect(rows.length).toBe(1);
      expect(rows[0].operation).toBe('create');expect(rows[0].outcome).toBe('rejected');expect(rows[0].finalized).toBe(1);
      expect(rows[0].callerId).toBe(null);expect(rows[0].tenantId).toBe(null);expect(rows[0].keyId).toBe(null);expect(rows[0].errorCode).toBe('E-01');
      expect(JSON.stringify(rows).includes(app.developerToken)).toBe(false);
    }finally{db.close();}
  }finally{await app.close();}
});
test('successful creation and its finalized outcome share a durable correlation without raw secrets',async()=>{
  const app=await startAcceptanceApp();try{
    const r=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);expect(r.status).toBe(201);
    const db=new DatabaseSync(app.databasePath);try{
      const row=db.prepare('SELECT a.outcome,a.finalized,a.callerId,a.tenantId,a.keyId FROM api_keys k JOIN security_attempts a ON a.attemptId=k.creationAttemptId WHERE k.keyId=?').get(r.body.keyId as string);
      expect(row?.outcome).toBe('succeeded');expect(row?.finalized).toBe(1);expect(row?.callerId).toBe('developer-a');expect(row?.keyId===r.body.keyId).toBe(true);
      expect(JSON.stringify(db.prepare('SELECT * FROM security_attempts').all()).includes(r.body.apiKey as string)).toBe(false);
    }finally{db.close();}
  }finally{await app.close();}
});
