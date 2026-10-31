import { expect,test } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { gracefulShutdown } from '../../src/bootstrap/process-lifecycle';
test('shutdown starts once across both signals and releases process listeners after server closure',()=>{
  const signals=new EventEmitter();let connections=0;let closes=0;
  const server=Object.assign(new EventEmitter(),{closeAllConnections(){connections++;},close(){closes++;}});
  gracefulShutdown(server as unknown as Server,signals);expect(signals.listenerCount('SIGINT')).toBe(1);expect(signals.listenerCount('SIGTERM')).toBe(1);
  signals.emit('SIGINT');signals.emit('SIGTERM');expect(connections).toBe(1);expect(closes).toBe(1);server.emit('close');expect(signals.listenerCount('SIGINT')+signals.listenerCount('SIGTERM')).toBe(0);
});
