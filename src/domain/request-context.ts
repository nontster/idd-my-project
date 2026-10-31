import type { Clock } from '../ports/clock';
import type { Outcome } from './outcome';

export interface RequestContext {
  readonly clock: Clock;
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly identityTimeoutMs: number;
}

export interface RequestScope {
  readonly context: RequestContext;
  cancel(): void;
  dispose(): void;
}

const identityDeadlines = new WeakMap<RequestContext, number>();
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
export function isActive(context: RequestContext): boolean {
  try {
    const now = context.clock.monotonicNow();
    return !context.signal.aborted && Number.isFinite(now) && Number.isFinite(context.deadline) && now < context.deadline;
  } catch { return false; }
}
// Timers wake waiters; elapsed monotonic time remains the authority.
function alarm(clock: Clock, deadline: number, expire: () => void): () => void {
  let cancel = () => {}; let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      const remaining = deadline - clock.monotonicNow();
      if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
      cancel = clock.schedule(Math.min(remaining, 2147483647), tick);
    } catch { expire(); }
  };
  tick(); return () => { stopped = true; cancel(); };
}
export function requestScope(clock: Clock, budget: number, identityBudget: number): Outcome<RequestScope> {
  if (![budget, identityBudget].every(n => Number.isInteger(n) && n > 0 && Number.isFinite(n))) return unavailable;
  try {
    const now = clock.monotonicNow(); const deadline = now + budget;
    if (!Number.isFinite(now) || !Number.isFinite(deadline)) return unavailable;
    const controller = new AbortController();
    const context = Object.freeze({ clock, deadline, identityTimeoutMs: identityBudget, signal: controller.signal });
    const stop = alarm(clock, deadline, () => controller.abort());
    const cancel = () => { stop(); controller.abort(); };
    return { ok: true, value: { context, cancel, dispose: cancel } };
  } catch { return unavailable; }
}
export async function withinContext<T>(context: RequestContext, operation: (signal: AbortSignal, remaining: number) => T | Promise<T>, identity = false): Promise<Outcome<T>> {
  if (!isActive(context)) return unavailable;
  let deadline = context.deadline;
  try {
    if (identity) {
      if (!Number.isFinite(context.identityTimeoutMs) || context.identityTimeoutMs <= 0) return unavailable;
      let shared = identityDeadlines.get(context);
      if (shared === undefined) { shared = Math.min(deadline, context.clock.monotonicNow() + context.identityTimeoutMs); identityDeadlines.set(context, shared); }
      deadline = Math.min(deadline, shared);
    }
    if (context.clock.monotonicNow() >= deadline) return unavailable;
    return await new Promise<Outcome<T>>(resolve => {
      const controller = new AbortController(); let settled = false; let stop = () => {};
      const finish = (result: Outcome<T>) => {
        if (settled) return;
        settled = true; stop(); context.signal.removeEventListener('abort', abort);
        controller.abort(); resolve(result);
      };
      const abort = () => finish(unavailable);
      context.signal.addEventListener('abort', abort, { once: true });
      stop = alarm(context.clock, deadline, abort);
      if (settled || !isActive(context)) { abort(); return; }
      try {
        const work = operation(controller.signal, deadline - context.clock.monotonicNow());
        Promise.resolve(work).then(value => {
          let active = false;
          try { active = isActive(context) && context.clock.monotonicNow() < deadline; } catch { /* deny */ }
          finish(active ? { ok: true, value } : unavailable);
        }, abort);
      } catch { abort(); }
    });
  } catch { return unavailable; }
}
