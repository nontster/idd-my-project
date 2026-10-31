import type { SecurityAttempt } from '../domain/security-attempt';
import type { Outcome } from '../domain/outcome';
export interface SecurityEventRepository {
  begin(attempt: SecurityAttempt): Outcome<void>;
  finalize(attempt: SecurityAttempt): Outcome<void>;
  unfinished(): Outcome<readonly SecurityAttempt[]>;
}
