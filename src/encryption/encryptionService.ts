import type { StoredLedgerEnvelopeV2 } from "./cryptoEnvelope";

/**
 * 加密位于 Repository 与 StorageAdapter 之间的唯一边界。
 */
export interface EncryptionService {
  encrypt(plaintext: string): Promise<StoredLedgerEnvelopeV2>;
  decrypt(envelope: StoredLedgerEnvelopeV2): Promise<string>;
}
