import type { StoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";

/**
 * StorageAdapter owns external persistence only; it does not interpret LedgerData or encrypted content.
 *
 * An empty store must return null rather than pretending that an empty ledger was saved.
 */
export interface StorageAdapter {
  read(): Promise<unknown | null>;
  write(envelope: StoredLedgerEnvelopeV2): Promise<void>;
  clear(): Promise<void>;
}

export type LegacyLedgerConditionalDeleteResult =
  | "deleted"
  | "missing"
  | "changed";

/**
 * The legacy exit path is intentionally narrower than StorageAdapter.clear().
 * It may delete only the exact encrypted record that was previously verified.
 */
export interface LegacyLedgerExitStorageAdapter extends StorageAdapter {
  deleteIfUnchanged(
    expectedEnvelope: StoredLedgerEnvelopeV2,
  ): Promise<LegacyLedgerConditionalDeleteResult>;
}
