export type Outcome<T> = { ok: true; value: T } | { ok: false; code: string };
