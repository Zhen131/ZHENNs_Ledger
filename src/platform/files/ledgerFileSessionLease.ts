export interface LedgerFileSessionLease {
  readonly sessionId: string;
  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}
