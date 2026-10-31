import { isErrorCode } from '../../domain/error-codes';
import { isUuid } from '../../domain/values';
export interface SafeEvent { operation?: unknown; requestId?: unknown; status?: unknown; code?: unknown; }
export function safeLogger(sink: (event: Record<string, unknown>) => void) {
  return (event: SafeEvent): boolean => {
    const output: Record<string, unknown> = {};
    if (['create','revoke','validate','list','retrieve','reactivate','transport'].includes(event.operation as string)) output.operation=event.operation;
    if (isUuid(event.requestId)) output.requestId=event.requestId;
    if (Number.isInteger(event.status) && Number(event.status)>=200 && Number(event.status)<=599) output.status=event.status;
    if (isErrorCode(event.code)) output.code=event.code;
    try { sink(output); return true; } catch { return false; }
  };
}
