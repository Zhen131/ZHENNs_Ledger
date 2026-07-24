import type { EncryptionService } from "./encryptionService";
import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  createCryptoEnvelopeMetadataV1,
  type StoredLedgerEnvelopeV2,
  validateStoredLedgerEnvelopeV2,
} from "./cryptoEnvelope";

const TEST_SALT = new Uint8Array(16);
const TEST_IV = new Uint8Array(12);
const TEST_TAG = new Uint8Array(16);

/**
 * 仅供隔离测试使用；production 组装不得引用。
 */
export class NoopEncryptionService implements EncryptionService {
  async encrypt(plaintext: string): Promise<StoredLedgerEnvelopeV2> {
    return createNoopStoredLedgerEnvelope(plaintext);
  }

  async decrypt(envelope: StoredLedgerEnvelopeV2): Promise<string> {
    const validation = validateStoredLedgerEnvelopeV2(envelope);

    if (!validation.ok) {
      throw new Error("Invalid test envelope");
    }

    const payload = base64UrlToBytes(
      validation.value.ciphertextBase64Url,
    );
    return new TextDecoder().decode(payload.subarray(TEST_TAG.length));
  }
}

export function createNoopStoredLedgerEnvelope(
  plaintext: string,
): StoredLedgerEnvelopeV2 {
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const payload = new Uint8Array(TEST_TAG.length + plaintextBytes.length);
  payload.set(TEST_TAG);
  payload.set(plaintextBytes, TEST_TAG.length);

  return {
    ...createCryptoEnvelopeMetadataV1(
      bytesToBase64Url(TEST_SALT),
      bytesToBase64Url(TEST_IV),
    ),
    ciphertextBase64Url: bytesToBase64Url(payload),
  };
}
