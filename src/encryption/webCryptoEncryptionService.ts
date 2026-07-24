import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  createCryptoAadV1,
  createCryptoEnvelopeMetadataV1,
  LEDGER_CRYPTO_CONSTANTS,
  type StoredLedgerEnvelopeV2,
  validateStoredLedgerEnvelopeV2,
} from "./cryptoEnvelope";
import type { EncryptionService } from "./encryptionService";

export type CryptoProvider = Pick<Crypto, "getRandomValues" | "subtle">;

export class WebCryptoEncryptionService implements EncryptionService {
  private constructor(
    private readonly key: CryptoKey,
    private readonly saltBase64Url: string,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  static async createForSetup(
    passphrase: string,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<WebCryptoEncryptionService> {
    const salt = cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_CRYPTO_CONSTANTS.saltBytes),
    );
    const key = await deriveLedgerKey(passphrase, salt, cryptoProvider);

    return new WebCryptoEncryptionService(
      key,
      bytesToBase64Url(salt),
      cryptoProvider,
    );
  }

  static async createForUnlock(
    passphrase: string,
    saltBase64Url: string,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<WebCryptoEncryptionService> {
    const salt = base64UrlToBytes(saltBase64Url);

    if (salt.byteLength !== LEDGER_CRYPTO_CONSTANTS.saltBytes) {
      throw new Error("Invalid ledger salt");
    }

    const key = await deriveLedgerKey(passphrase, salt, cryptoProvider);
    return new WebCryptoEncryptionService(
      key,
      saltBase64Url,
      cryptoProvider,
    );
  }

  async encrypt(plaintext: string): Promise<StoredLedgerEnvelopeV2> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_CRYPTO_CONSTANTS.ivBytes),
    );
    const metadata = createCryptoEnvelopeMetadataV1(
      this.saltBase64Url,
      bytesToBase64Url(iv),
    );
    const additionalData = createCryptoAadV1(metadata);
    const encrypted = await this.cryptoProvider.subtle.encrypt(
      {
        name: LEDGER_CRYPTO_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_CRYPTO_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(new TextEncoder().encode(plaintext)),
    );

    return {
      ...metadata,
      ciphertextBase64Url: bytesToBase64Url(new Uint8Array(encrypted)),
    };
  }

  async decrypt(envelope: StoredLedgerEnvelopeV2): Promise<string> {
    const validation = validateStoredLedgerEnvelopeV2(envelope);

    if (!validation.ok) {
      throw new Error("Invalid encrypted ledger envelope");
    }

    const iv = base64UrlToBytes(validation.value.cipher.ivBase64Url);
    const ciphertext = base64UrlToBytes(
      validation.value.ciphertextBase64Url,
    );
    const additionalData = createCryptoAadV1(validation.value);
    const decrypted = await this.cryptoProvider.subtle.decrypt(
      {
        name: LEDGER_CRYPTO_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_CRYPTO_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(ciphertext),
    );

    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  }
}

export async function deriveLedgerKey(
  passphrase: string,
  salt: Uint8Array,
  cryptoProvider: CryptoProvider = globalThis.crypto,
): Promise<CryptoKey> {
  const baseKey = await cryptoProvider.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    LEDGER_CRYPTO_CONSTANTS.kdfName,
    false,
    ["deriveKey"],
  );

  return cryptoProvider.subtle.deriveKey(
    {
      name: LEDGER_CRYPTO_CONSTANTS.kdfName,
      hash: LEDGER_CRYPTO_CONSTANTS.kdfHash,
      iterations: LEDGER_CRYPTO_CONSTANTS.kdfIterations,
      salt: toArrayBuffer(salt),
    },
    baseKey,
    {
      name: LEDGER_CRYPTO_CONSTANTS.cipherName,
      length: LEDGER_CRYPTO_CONSTANTS.keyLength,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
