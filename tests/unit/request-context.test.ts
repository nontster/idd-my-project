import { expect, test } from '@jest/globals';
import { isActive, requestScope, withinContext } from '../../src/domain/request-context';
import { deferred, manualClock, requestFixture } from '../support/identity-fixtures';

test('a request scope uses one absolute monotonic deadline and disposes its timer', () => {
  const clock = manualClock(); clock.advance(25);
  const result = requestScope(clock, 200, 100); expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.context.deadline).toBe(225);
  expect(isActive(result.value.context)).toBe(true);
  expect(clock.timerCount()).toBe(1);
  result.value.dispose();
  expect(isActive(result.value.context)).toBe(false);
  expect(clock.timerCount()).toBe(0);
});

test.each([0, -1, 0.5, Number.NaN, Infinity])('invalid request budgets fail closed', budget => {
  expect(requestScope(manualClock(), budget, 100).ok).toBe(false);
  expect(requestScope(manualClock(), 200, budget).ok).toBe(false);
});

test('scope cancellation happens exactly at expiry and remains one-way', () => {
  const clock = manualClock(); const scope = requestScope(clock, 100, 100); expect(scope.ok).toBe(true);
  if (!scope.ok) return;
  clock.advance(99); expect(isActive(scope.value.context)).toBe(true);
  clock.advance(1); expect(scope.value.context.signal.aborted).toBe(true);
  scope.value.cancel(); scope.value.dispose(); expect(clock.timerCount()).toBe(0);
});

test('active work can resolve without leaking timers or listeners', async () => {
  const { context, clock } = requestFixture();
  const result = await withinContext(context, () => 7, true);
  expect(result.ok && result.value === 7).toBe(true); expect(clock.timerCount()).toBe(0);
});

test('identity calls share a non-resetting deadline', async () => {
  const { context, clock } = requestFixture();
  const first = await withinContext(context, () => { clock.advance(60); return 1; }, true);
  expect(first.ok).toBe(true);
  const second = await withinContext(context, () => { clock.advance(40); return 2; }, true);
  expect(second.ok ? 'SUCCESS' : second.code).toBe('UNAVAILABLE');
});

test('request expiry clamps identity work and ignores delayed timer delivery', async () => {
  const { context, clock } = requestFixture(50);
  const result = await withinContext(context, () => { clock.advance(50, false); return true; }, true);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('expired and pre-cancelled contexts never start further work', async () => {
  for (const kind of ['expired', 'cancelled']) {
    const { context, clock, controller } = requestFixture(); let called = false;
    if (kind === 'expired') clock.advance(200, false); else controller.abort();
    const result = await withinContext(context, () => { called = true; return true; });
    expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE'); expect(called).toBe(false);
  }
});

test('identity timeout aborts the provider signal without waiting for a late success', async () => {
  const { context, clock } = requestFixture(); const started = deferred(); const release = deferred();
  let signal: AbortSignal | undefined; let count = 0;
  const pending = withinContext(context, async (providerSignal, remaining) => {
    count++; signal = providerSignal; expect(remaining).toBe(100); started.resolve(); await release.promise; return true;
  }, true);
  try {
    const first = await Promise.race([started.promise.then(() => 'started'), pending.then(() => 'result')]);
    expect(first).toBe('started'); clock.advance(100);
    const result = await pending; expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
    expect(signal?.aborted).toBe(true); release.resolve(); await Promise.resolve();
    expect(count).toBe(1); expect(clock.timerCount()).toBe(0);
  } finally { release.resolve(); }
});

test('cancellation stops a waiting operation and its eventual rejection is consumed', async () => {
  const { context, controller, clock } = requestFixture(); const started = deferred(); const release = deferred();
  const pending = withinContext(context, async () => { started.resolve(); await release.promise; throw new Error('provider rejected'); });
  try {
    const first = await Promise.race([started.promise.then(() => 'started'), pending.then(() => 'result')]);
    expect(first).toBe('started'); controller.abort();
    const result = await pending; expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
    release.resolve(); await Promise.resolve(); expect(clock.timerCount()).toBe(0);
  } finally { release.resolve(); }
});

test('synchronous and asynchronous work failures become safe unavailable results', async () => {
  const { context } = requestFixture();
  const one = await withinContext(context, () => { throw new Error('controlled failure'); });
  const two = await withinContext(context, () => Promise.reject(new Error('controlled rejection')));
  expect(one.ok ? 'SUCCESS' : one.code).toBe('UNAVAILABLE');
  expect(two.ok ? 'SUCCESS' : two.code).toBe('UNAVAILABLE');
});

test('unusable clock readings cannot make an active request', () => {
  const { context, clock } = requestFixture();
  const invalid = { ...clock, monotonicNow: () => Number.NaN };
  expect(requestScope(invalid, 200, 100).ok).toBe(false);
  expect(isActive({ ...context, clock: { ...clock, monotonicNow: () => { throw new Error('clock unavailable'); } } })).toBe(false);
});
