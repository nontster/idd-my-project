import { jest } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
export const storageSettings = [
  {pragma:'journal_mode',field:'journal_mode',unsafe:'DELETE',actual:'delete'},
  {pragma:'synchronous',field:'synchronous',unsafe:'OFF',actual:0},
  {pragma:'foreign_keys',field:'foreign_keys',unsafe:'OFF',actual:0},
  {pragma:'busy_timeout',field:'timeout',unsafe:'25',actual:25},
] as const;
// Inject a real native setting change after the requested startup configuration.
export function unsafeSetting(setting:typeof storageSettings[number]){
  const exec=DatabaseSync.prototype.exec;let observed=false;
  const spy=jest.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
    exec.call(this,sql);
    if(sql.includes('PRAGMA busy_timeout=0;')){
      exec.call(this,`PRAGMA ${setting.pragma}=${setting.unsafe};`);
      observed=this.prepare(`PRAGMA ${setting.pragma}`).get()?.[setting.field]===setting.actual;
    }
  });
  return {observed:()=>observed,restore:()=>spy.mockRestore()};
}
