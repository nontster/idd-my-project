import { performance } from 'node:perf_hooks';
import type { Clock } from '../../ports/clock';
export const systemClock: Clock = {
  monotonicNow:()=>performance.now(), utcNow:()=>new Date().toISOString(),
  schedule(ms,callback){const timer=setTimeout(callback,ms);timer.unref();return ()=>clearTimeout(timer);},
};
