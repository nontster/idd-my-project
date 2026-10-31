import type { Outcome } from '../domain/outcome';
import { isActive, type RequestContext } from '../domain/request-context';

export class DecisionGate {
  private tail: Promise<void> = Promise.resolve();
  run<T>(context: RequestContext, operation: () => T): Promise<Outcome<T>> {
    const result = this.tail.then((): Outcome<T> => {
      if (!isActive(context) || operation.constructor.name === 'AsyncFunction') return { ok: false, code: 'UNAVAILABLE' };
      try {
        const value = operation();
        if (value && typeof (value as { then?: unknown }).then === 'function') {
          Promise.resolve(value).catch(() => {}); return { ok: false, code: 'UNAVAILABLE' };
        }
        return isActive(context) ? { ok: true, value } : { ok: false, code: 'UNAVAILABLE' };
      } catch { return { ok: false, code: 'UNAVAILABLE' }; }
    });
    this.tail = result.then(() => {}); return result;
  }
}
