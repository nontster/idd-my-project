import { expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AuthenticationService } from '../../src/services/authentication';
import { createApplication } from '../../src/bootstrap/app';
import type { Principal } from '../../src/domain/identity';
import { createIdentityFixtures, deferred, requestFixture } from '../support/identity-fixtures';

const developer: Principal = { kind: 'developer', subjectId: 'developer-a', trustedService: false };
const service: Principal = { kind: 'service', subjectId: 'platform-service', trustedService: true };

test('existing provider verifies the management caller rather than caller-supplied role claims', async () => {
  const f = createIdentityFixtures(); const { context } = requestFixture();
  const result = await new AuthenticationService(f.verifier).caller(f.developerToken, 'management', context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.subjectId).toBe('developer-a');
});

test('trusted service identity is independently verified for validation', async () => {
  const f = createIdentityFixtures(); const { context } = requestFixture();
  const result = await new AuthenticationService(f.verifier).caller(f.serviceToken, 'validation', context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.kind).toBe('service');
});

test.each(['developer', 'untrusted-service'] as const)('%s cannot become a trusted validation caller', async kind => {
  const f = createIdentityFixtures(); const { context } = requestFixture();
  const token = kind === 'developer' ? f.developerToken : f.untrustedServiceToken;
  const result = await new AuthenticationService(f.verifier).caller(token, 'validation', context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-16');
});

test.each(['missing', 'empty', 'unknown', 'object'] as const)('%s credentials are rejected without inventing identity', async kind => {
  const f = createIdentityFixtures(); const { context } = requestFixture();
  const credential = { missing: undefined, empty: '', unknown: randomUUID(), object: {} }[kind];
  const result = await new AuthenticationService(f.verifier).caller(credential, 'management', context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-01');
});

test('provider unavailability differs from invalid credentials', async () => {
  const f = createIdentityFixtures(); f.unavailable = true;
  const result = await new AuthenticationService(f.verifier).caller(f.developerToken, 'management', requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('provider rejection is a safe unavailable outcome', async () => {
  const f = createIdentityFixtures(); f.beforeAuthenticate = async () => { throw new Error('provider offline'); };
  const result = await new AuthenticationService(f.verifier).caller(f.serviceToken, 'validation', requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each([null, undefined, { kind: 'unexpected' }, { kind: 'verified', principal: null },
  { kind: 'verified', principal: { kind: 'service', subjectId: '', trustedService: true } },
  { kind: 'verified', principal: { kind: 'unknown', subjectId: 'actor', trustedService: true } },
])('malformed provider results never establish caller trust', async value => {
  const f = createIdentityFixtures(); const verifier = { ...f.verifier, authenticate: async () => value };
  const result = await new AuthenticationService(verifier).caller(f.serviceToken, 'validation', requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('any verified same-Tenant developer receives management context', async () => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .management({ ...developer, subjectId: 'developer-colleague' }, 'tenant-a', requestFixture().context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.tenantId).toBe('tenant-a');
});

test.each([undefined, null, ''])('missing scope cannot issue or manage an unscoped key', async selector => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .management(developer, selector, requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-02');
});

test.each([7, ['tenant-a', 'tenant-b'], ' ', 'a'.repeat(257)])('malformed or duplicated scope is rejected', async selector => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .management(developer, selector, requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-03');
});

test.each(['tenant-b', 'tenant-nonexistent'])('inaccessible scope has the same denial as nonexistent scope', async selector => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .management(developer, selector, requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-04');
});

test('service identity alone grants no developer management authority', async () => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .management(service, 'tenant-a', requestFixture().context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('E-04');
});

test('trusted expected Tenant context is obtained from the host, not the selector alone', async () => {
  const f = createIdentityFixtures(); const result = await new AuthenticationService(f.verifier)
    .validation(service, 'tenant-b', randomUUID(), requestFixture().context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.tenantId).toBe('tenant-b');
});

test('unavailable management and validation contexts are never guessed', async () => {
  const f = createIdentityFixtures(); f.unavailable = true; const auth = new AuthenticationService(f.verifier);
  const management = await auth.management(developer, 'tenant-a', requestFixture().context);
  expect(management.ok ? 'SUCCESS' : management.code).toBe('UNAVAILABLE');
  const validation = await auth.validation(service, 'tenant-a', randomUUID(), requestFixture().context);
  expect(validation.ok ? 'SUCCESS' : validation.code).toBe('UNAVAILABLE');
});

test('normal composition cannot fall back to fixture identity', () => {
  const f = createIdentityFixtures(); let code = 'NO_FAILURE';
  try { createApplication({ databasePath: ':memory:', identityVerifier: f.verifier }); }
  catch (error) { code = (error as { code: string }).code; }
  expect(code).toBe('IDENTITY_REQUIRED');
});

test('successive identity calls share one budget rather than restarting 100 milliseconds', async () => {
  const f = createIdentityFixtures(); const { context, clock } = requestFixture();
  f.beforeAuthenticate = async () => { clock.advance(60); };
  const verifier = { ...f.verifier, authorizeManagement: async () => {
    clock.advance(40); return { kind: 'authorized', tenantId: 'tenant-a' };
  } };
  const auth = new AuthenticationService(verifier);
  const caller = await auth.caller(f.developerToken, 'management', context);
  expect(caller.ok).toBe(true);
  if (!caller.ok) return;
  const result = await auth.management(caller.value, 'tenant-a', context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('request deadline clamps a longer identity budget', async () => {
  const f = createIdentityFixtures(); const { context, clock } = requestFixture(50);
  f.beforeAuthenticate = async () => { clock.advance(50); };
  const result = await new AuthenticationService(f.verifier).caller(f.serviceToken, 'validation', context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('pre-cancelled requests never invoke the provider', async () => {
  const f = createIdentityFixtures(); const { context, controller } = requestFixture(); controller.abort();
  const result = await new AuthenticationService(f.verifier).caller(f.serviceToken, 'validation', context);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
  expect(f.calls.authenticate).toBe(0);
});

test('timed-out provider completion cannot revive caller trust or trigger a retry', async () => {
  const f = createIdentityFixtures(); const { context, clock } = requestFixture();
  const started = deferred(); const release = deferred();
  f.beforeAuthenticate = async () => { started.resolve(); await release.promise; };
  const pending = new AuthenticationService(f.verifier).caller(f.serviceToken, 'validation', context);
  try {
    const first = await Promise.race([started.promise.then(() => 'started'), pending.then(() => 'result')]);
    expect(first).toBe('started');
    clock.advance(100);
    const result = await pending;
    expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
    release.resolve(); await Promise.resolve();
    expect(f.calls.authenticate).toBe(1);
  } finally { release.resolve(); }
});

test('absent provider and malformed role attributes fail closed',async()=>{
  const f=createIdentityFixtures();const ctx=()=>requestFixture().context;
  expect((await new AuthenticationService(undefined).caller(f.serviceToken,'validation',ctx())).ok).toBe(false);
  const verifier={...f.verifier,authenticate:async()=>({kind:'verified',principal:{kind:'other',subjectId:'actor',trustedService:'yes'}})};
  expect((await new AuthenticationService(verifier).caller(f.serviceToken,'validation',ctx())).ok).toBe(false);
});
test('malformed membership and format responses never establish authority',async()=>{
  const f=createIdentityFixtures();
  for(const value of [null,{}, {kind:'authorized',tenantId:'tenant-b'},{kind:'unavailable'}]){
    const auth=new AuthenticationService({...f.verifier,authorizeManagement:async()=>value});
    expect((await auth.management(developer,'tenant-a',requestFixture().context)).ok).toBe(false);
  }
  expect((await new AuthenticationService({...f.verifier,validateTenantIdentifier:()=>null}).management(developer,'tenant-a',requestFixture().context)).ok).toBe(false);
});
test('validation directly enforces service trust, binding and exact verified context',async()=>{
  const f=createIdentityFixtures();
  for(const p of [developer,{...service,trustedService:false}])expect((await new AuthenticationService(f.verifier).validation(p,'tenant-a',randomUUID(),requestFixture().context)).ok).toBe(false);
  for(const selector of [null,7,''])expect((await new AuthenticationService(f.verifier).validation(service,selector,randomUUID(),requestFixture().context)).ok).toBe(false);
  expect((await new AuthenticationService(f.verifier).validation(service,'tenant-a','invalid',requestFixture().context)).ok).toBe(false);
  for(const value of [null,{}, {kind:'verified',tenantId:'tenant-b'}])expect((await new AuthenticationService({...f.verifier,establishValidationContext:async()=>value}).validation(service,'tenant-a',randomUUID(),requestFixture().context)).ok).toBe(false);
});
