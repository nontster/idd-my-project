export type CommitOutcome<T> = { kind: 'committed'; value: T } | { kind: 'not-committed' | 'uncertain' };
export interface MutationUnitOfWork { run<T>(mutation: () => T): CommitOutcome<T>; }
