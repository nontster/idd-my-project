import { expect, test } from '@jest/globals';
import { DecisionGate } from '../../src/services/decision-gate';
import { requestFixture } from '../support/identity-fixtures';

test('final decision callbacks share one observable total order', async () => {
  const gate = new DecisionGate(); const { context } = requestFixture(); const order: number[] = [];
  const results = await Promise.all([gate.run(context, () => { order.push(1); return 1; }),
    gate.run(context, () => { order.push(2); return 2; })]);
  expect(results.every(result => result.ok)).toBe(true);
  expect(order).toEqual([1, 2]);
});

test('callback failure releases the ordering gate for the next legitimate decision', async () => {
  const gate = new DecisionGate(); const { context } = requestFixture();
  const failed = await gate.run(context, () => { throw new Error('controlled callback failure'); });
  expect(failed.ok ? 'SUCCESS' : failed.code).toBe('UNAVAILABLE');
  const next = await gate.run(context, () => 7);
  expect(next.ok && next.value === 7).toBe(true);
});

test('asynchronous final callbacks are rejected before their body executes', async () => {
  const gate = new DecisionGate(); const { context } = requestFixture(); let entered = false;
  const result = await gate.run(context, async () => { entered = true; return 1; });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
  expect(entered).toBe(false);
});

test('a returned promise cannot suspend the final decision boundary', async () => {
  const gate = new DecisionGate(); const { context } = requestFixture();
  const result = await gate.run(context, () => new Promise<number>(() => {}));
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
  expect((await gate.run(context, () => true)).ok).toBe(true);
});

test('an eligible callback just before its deadline can finalize normally', async () => {
  const gate = new DecisionGate(); const { context, clock } = requestFixture(100); clock.advance(99);
  const result = await gate.run(context, () => true);
  expect(result.ok && result.value).toBe(true);
});

test('elapsed time at the deadline denies even if the cancellation timer has not fired', async () => {
  const gate = new DecisionGate(); const { context, clock } = requestFixture(100); clock.advance(100, false);
  let entered = false; const result = await gate.run(context, () => { entered = true; return true; });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
  expect(entered).toBe(false);
});

test('an expired result after an entered synchronous callback is not acknowledged or replayed', async () => {
  const gate = new DecisionGate(); const { context, clock } = requestFixture(100); let attempts = 0;
  const result = await gate.run(context, () => { attempts++; clock.advance(100, false); return true; });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE'); expect(attempts).toBe(1);
});

test('queued cancellation prevents a later callback from running', async () => {
  const gate = new DecisionGate(); const first = requestFixture(); const second = requestFixture(); let entered = false;
  const a = gate.run(first.context, () => { second.controller.abort(); return 1; });
  const b = gate.run(second.context, () => { entered = true; return 2; });
  const [one, two] = await Promise.all([a, b]);
  expect(one.ok).toBe(true);
  expect(two.ok ? 'SUCCESS' : two.code).toBe('UNAVAILABLE'); expect(entered).toBe(false);
});
