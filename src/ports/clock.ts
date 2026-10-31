export interface Clock {
  monotonicNow(): number;
  utcNow(): string;
  schedule(milliseconds: number, callback: () => void): () => void;
}
