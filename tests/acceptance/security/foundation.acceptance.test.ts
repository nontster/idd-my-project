import { storageSettings, unsafeSetting } from '../../support/storage-setting-faults';
import { expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apiRequest, startAcceptanceApp } from '../../support/acceptance-app';
import { createIdentityFixtures, deferred, manualClock } from '../../support/identity-fixtures';
import { createApplication, createDevelopmentApplication } from '../../../src/bootstrap/app';

test('missing management authentication is rejected before any key operation', async () => {
  const app = await startAcceptanceApp();
  try {
    const response = await apiRequest(app.url, '/v1/api-keys', '', {}, app.tenantId);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('E-01');
  } finally { await app.close(); }
});

test('a forged Tenant membership header cannot grant cross-Tenant management', async () => {
  const app = await startAcceptanceApp();
  try {
    const response = await fetch(app.url + '/v1/api-keys', { method: 'POST', headers: {
      authorization: `Bearer ${app.developerToken}`, 'x-tenant-id': 'tenant-b',
      'x-caller-role': 'developer', 'x-tenant-membership': 'tenant-b', 'content-type': 'application/json',
    }, body: '{}' });
    expect(response.status).toBe(403);
    const body = await response.json() as {error:{code:string}};
    expect(body.error.code).toBe('E-04');
    expect(app.logs.every(line => !line.includes(app.developerToken))).toBe(true);
  } finally { await app.close(); }
});

test('developer identity cannot validate even when a key is supplied', async () => {
  const app = await startAcceptanceApp();
  try {
    const response = await apiRequest(app.url, '/v1/api-keys/validations', app.developerToken,
      { apiKey: randomUUID(), expectedTenantId: app.tenantId, requestId: randomUUID() });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('E-16');
  } finally { await app.close(); }
});

test('unavailable service identity denies validation without credential diagnostics', async () => {
  const identities = createIdentityFixtures(); identities.unavailable = true;
  const app = await startAcceptanceApp({}, identities);
  try {
    const response = await apiRequest(app.url, '/v1/api-keys/validations', app.serviceToken,
      { apiKey: randomUUID(), expectedTenantId: app.tenantId, requestId: randomUUID() });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('E-10');
    expect(app.logs.every(line => !line.includes(app.serviceToken))).toBe(true);
  } finally { await app.close(); }
});

test('shared identity deadline denies a hung verifier and ignores its late result', async () => {
  const identities = createIdentityFixtures(); const started = deferred(); const release = deferred();
  identities.beforeAuthenticate = async () => { started.resolve(); await release.promise; };
  const clock = manualClock(); const app = await startAcceptanceApp({ clock }, identities);
  try {
    const pending = apiRequest(app.url, '/v1/api-keys/validations', app.serviceToken,
      { apiKey: randomUUID(), expectedTenantId: app.tenantId, requestId: randomUUID() });
    const first = await Promise.race([started.promise.then(() => 'started'), pending.then(() => 'response')]);
    expect(first).toBe('started');
    clock.advance(100);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('E-10');
    release.resolve();
    expect(identities.calls.authenticate).toBe(1);
    expect(identities.calls.context).toBe(0);
  } finally { release.resolve(); await app.close(); }
}, 15000);

function failureCode(action: () => unknown): string {
  try { action(); return 'NO_FAILURE'; }
  catch (error) { return (error as { code?: string }).code ?? 'UNCLASSIFIED'; }
}

test('premature HTTP disconnect cancels pending identity before any key operation', async () => {
  const identities = createIdentityFixtures(); const started = deferred();
  const release = deferred(); const cancelled = deferred(); const answered = deferred();
  identities.beforeAuthenticate = async value => {
    const context = value as { signal: AbortSignal };
    context.signal.addEventListener('abort', cancelled.resolve, { once: true });
    started.resolve(); await release.promise;
  };
  const app = await startAcceptanceApp({}, identities);
  const request = httpRequest(app.url + '/v1/api-keys', { method: 'POST', headers: {
    authorization: `Bearer ${app.developerToken}`, 'x-tenant-id': app.tenantId,
    'content-type': 'application/json',
  } }, response => { response.resume(); answered.resolve(); });
  request.on('error', () => {});
  try {
    request.end('{}');
    const first = await Promise.race([started.promise.then(() => 'started'), answered.promise.then(() => 'response')]);
    expect(first).toBe('started');
    request.destroy(); await cancelled.promise; release.resolve();
    expect(identities.calls.management).toBe(0);
  } finally { request.destroy(); release.resolve(); await app.close(); }
}, 15000);

test('normal composition refuses missing real identity integration before opening storage', () => {
  expect(failureCode(() => createApplication({ databasePath: ':memory:' }))).toBe('IDENTITY_REQUIRED');
});

test('development composition refuses a non-loopback host', () => {
  expect(failureCode(() => createDevelopmentApplication({ databasePath: ':memory:',
    identityVerifier: createIdentityFixtures().verifier, host: '0.0.0.0', initializeFreshStore: true }))).toBe('INVALID_DEVELOPMENT_HOST');
});

test.each([0, -1, 0.5, Number.NaN])('invalid timeout configuration refuses bootstrap', value => {
  expect(failureCode(() => createDevelopmentApplication({ databasePath: ':memory:',
    identityVerifier: createIdentityFixtures().verifier, host: '127.0.0.1', initializeFreshStore: true,
    configuration: { identityTimeoutMs: value } }))).toBe('INVALID_CONFIGURATION');
});

test.each([
  {identityTimeoutMs:201}, {validationTimeoutMs:500}, {managementTimeoutMs:99},
  {gatewayValidationTimeoutMs:Infinity}, {validationTimeoutMs:null},
])('inconsistent lifecycle budgets refuse bootstrap', configuration => {
  expect(failureCode(()=>createDevelopmentApplication({databasePath:':memory:',host:'127.0.0.1',
    identityVerifier:createIdentityFixtures().verifier,configuration}))).toBe('INVALID_CONFIGURATION');
});

test('normal and development startup refuse missing/corrupt authority without silently recreating it',()=>{
  const directory=mkdtempSync(join(tmpdir(),'key-startup-')); const path=join(directory,'authority.sqlite');
  try{
    const options={databasePath:path,host:'127.0.0.1',identityVerifier:createIdentityFixtures().verifier};
    expect(failureCode(()=>createDevelopmentApplication(options))).toBe('STORE_UNAVAILABLE');
    expect(existsSync(path)).toBe(false); writeFileSync(path,'corrupt authority');
    expect(failureCode(()=>createDevelopmentApplication({...options,initializeFreshStore:true}))).toBe('STORE_UNAVAILABLE');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('readiness exposes only a safe ready boolean for a checked durable authority',async()=>{
  const app=await startAcceptanceApp();
  try{const response=await fetch(app.url+'/health/ready');expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ready:true});expect(response.headers.get('cache-control')).toBe('no-store');
  }finally{await app.close();}
});

test.each(storageSettings)('unsafe effective $pragma prevents authority startup before any key work',async setting=>{
  const directory=mkdtempSync(join(tmpdir(),'key-setting-startup-'));const identities=createIdentityFixtures();const fault=unsafeSetting(setting);let server:ReturnType<typeof createDevelopmentApplication>|undefined;let code='NO_FAILURE';
  try{
    try{server=createDevelopmentApplication({databasePath:join(directory,'authority.sqlite'),identityVerifier:identities.verifier,initializeFreshStore:true,host:'127.0.0.1'});}catch(error){code=(error as {code:string}).code;}
    expect(fault.observed()).toBe(true);expect(code).toBe('STORE_UNAVAILABLE');expect(server===undefined).toBe(true);expect(identities.calls.authenticate).toBe(0);
  }finally{fault.restore();if(server)await new Promise<void>(done=>server!.close(()=>done()));rmSync(directory,{recursive:true,force:true});}
});
