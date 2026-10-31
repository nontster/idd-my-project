import { DecisionGate } from '../../src/services/decision-gate';
import type { RequestContext } from '../../src/domain/request-context';
import { deferred } from './identity-fixtures';
export class ControlledGate extends DecisionGate {
  private next:ReturnType<typeof this.arm>|undefined;
  arm(){const entered=deferred();const released=deferred();const control={entered:entered.promise,release:released.resolve,wait:released.promise,notify:entered.resolve,context:undefined as RequestContext|undefined};this.next=control;return control;}
  override async run<T>(context:RequestContext,operation:()=>T){const control=this.next;this.next=undefined;if(control){control.context=context;control.notify();await control.wait;}return super.run(context,operation);}
}
