import type { StoredLedgerEnvelopeV2 } from "./cryptoEnvelope";

/**
 * Encryption is the single boundary between Repository and StorageAdapter.
 */
export interface EncryptionService {
  encrypt(plaintext: string): Promise<StoredLedgerEnvelopeV2>;
  decrypt(envelope: StoredLedgerEnvelopeV2): Promise<string>;
}
