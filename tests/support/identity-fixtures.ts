import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/domain/request-context';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export function manualClock() {
  let elapsed = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    monotonicNow: () => elapsed,
    utcNow: () => new Date(Date.UTC(2026, 0, 1) + elapsed).toISOString(),
    schedule: (milliseconds: number, callback: () => void) => {
      const id = ++sequence; timers.set(id, { at: elapsed + milliseconds, callback });
      return () => { timers.delete(id); };
    },
    advance: (milliseconds: number, deliver = true) => {
      elapsed += milliseconds;
      if (deliver) for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= elapsed) {
        timers.delete(id); timer.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

export function createIdentityFixtures() {
  const developerToken = randomUUID(); const colleagueToken = randomUUID(); const tenantBDeveloperToken=randomUUID();
  const serviceToken = randomUUID(); const untrustedServiceToken = randomUUID();
  const credentials = new Map<string, { kind: string; subjectId: string; trustedService: boolean }>([
    [developerToken, { kind: 'developer', subjectId: 'developer-a', trustedService: false }],
    [colleagueToken, { kind: 'developer', subjectId: 'developer-colleague', trustedService: false }],
    [tenantBDeveloperToken,{kind:'developer',subjectId:'developer-b',trustedService:false}],
    [serviceToken, { kind: 'service', subjectId: 'platform-service', trustedService: true }],
    [untrustedServiceToken, { kind: 'service', subjectId: 'untrusted-service', trustedService: false }],
  ]);
  const fixture = {
    developerToken, colleagueToken, tenantBDeveloperToken, serviceToken, untrustedServiceToken,
    unavailable: false,
    beforeAuthenticate: undefined as undefined | ((context: unknown) => Promise<void>),
    calls: { authenticate: 0, management: 0, context: 0 },
    verifier: {
      mode: 'fixture',
      async authenticate(credential: string, _context: unknown) {
        fixture.calls.authenticate++;
        if (fixture.beforeAuthenticate) await fixture.beforeAuthenticate(_context);
        if (fixture.unavailable) return { kind: 'unavailable' };
        const principal = credentials.get(credential);
        return principal ? { kind: 'verified', principal: { ...principal } } : { kind: 'invalid' };
      },
      validateTenantIdentifier(selector: string) { return /^[a-z][a-z0-9-]*$/.test(selector); },
      async authorizeManagement(principal: { kind: string; subjectId:string }, tenantId: string, _context: unknown) {
        fixture.calls.management++;
        if (fixture.unavailable) return { kind: 'unavailable' };
        return principal.kind === 'developer' && tenantId === (principal.subjectId==='developer-b'?'tenant-b':'tenant-a')
          ? { kind: 'authorized', tenantId } : { kind: 'denied' };
      },
      async establishValidationContext(principal: { kind: string; trustedService: boolean }, tenantId: string, _requestId: string, _context: unknown) {
        fixture.calls.context++;
        if (fixture.unavailable) return { kind: 'unavailable' };
        return principal.kind === 'service' && principal.trustedService && ['tenant-a', 'tenant-b'].includes(tenantId)
          ? { kind: 'verified', tenantId } : { kind: 'unavailable' };
      },
    },
  };
  return fixture;
}

export function requestFixture(budget = 200) {
  const clock = manualClock(); const controller = new AbortController();
  const context: RequestContext = { clock, deadline: budget, signal: controller.signal, identityTimeoutMs: 100 };
  return { context, clock, controller };
}
