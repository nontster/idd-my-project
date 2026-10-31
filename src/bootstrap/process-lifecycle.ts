import type { Server } from 'node:http';
export interface SignalSource {
  once(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown;
  removeListener(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown;
}
export function gracefulShutdown(server:Server,signals:SignalSource=process):void{
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.closeAllConnections();server.close();};
  signals.once('SIGINT',stop);signals.once('SIGTERM',stop);
  server.once('close',()=>{signals.removeListener('SIGINT',stop);signals.removeListener('SIGTERM',stop);});
}
