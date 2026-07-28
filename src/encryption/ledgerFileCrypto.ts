import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  LEDGER_FILE_V1_CONSTANTS,
  createLedgerFileCryptoV1,
  createLedgerFileGenerationAadV1,
  type EncryptedLedgerGenerationV1,
  type LedgerFileCryptoV1,
} from "./ledgerFileContract";
import {
  deriveLedgerKey,
  type CryptoProvider,
} from "./webCryptoEncryptionService";

export class LedgerFileCrypto {
  private constructor(
    private readonly key: CryptoKey,
    private readonly metadata: LedgerFileCryptoV1,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  static async createForSetup(
    passphrase: string,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<LedgerFileCrypto> {
    const salt = cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_V1_CONSTANTS.saltBytes),
    );
    const key = await deriveLedgerKey(passphrase, salt, cryptoProvider);
    return new LedgerFileCrypto(
      key,
      createLedgerFileCryptoV1(bytesToBase64Url(salt)),
      cryptoProvider,
    );
  }

  static async createForUnlock(
    passphrase: string,
    metadata: LedgerFileCryptoV1,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<LedgerFileCrypto> {
    const salt = base64UrlToBytes(metadata.kdf.saltBase64Url);
    if (salt.byteLength !== LEDGER_FILE_V1_CONSTANTS.saltBytes) {
      throw new Error("Invalid ledger file salt");
    }

    const key = await deriveLedgerKey(passphrase, salt, cryptoProvider);
    return new LedgerFileCrypto(key, metadata, cryptoProvider);
  }

  getCryptoMetadata(): LedgerFileCryptoV1 {
    return {
      cryptoVersion: this.metadata.cryptoVersion,
      kdf: { ...this.metadata.kdf },
      cipher: { ...this.metadata.cipher },
    };
  }

  async encryptGeneration(
    fileId: string,
    revision: {
      revisionId: string;
      parentRevisionId: string | null;
      ledgerSchemaVersion: 1;
    },
    serializedPayload: string,
  ): Promise<EncryptedLedgerGenerationV1> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_V1_CONSTANTS.ivBytes),
    );
    const generationMetadata = {
      ...revision,
      ivBase64Url: bytesToBase64Url(iv),
    };
    const additionalData = createLedgerFileGenerationAadV1(
      {
        fileFormatVersion: LEDGER_FILE_V1_CONSTANTS.fileFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      generationMetadata,
    );
    const encrypted = await this.cryptoProvider.subtle.encrypt(
      {
        name: LEDGER_FILE_V1_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_V1_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(new TextEncoder().encode(serializedPayload)),
    );

    return {
      ...generationMetadata,
      ciphertextBase64Url: bytesToBase64Url(new Uint8Array(encrypted)),
    };
  }

  async decryptGeneration(
    fileId: string,
    generation: EncryptedLedgerGenerationV1,
  ): Promise<string> {
    const iv = base64UrlToBytes(generation.ivBase64Url);
    const ciphertext = base64UrlToBytes(
      generation.ciphertextBase64Url,
    );
    const generationMetadata = {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    };
    const additionalData = createLedgerFileGenerationAadV1(
      {
        fileFormatVersion: LEDGER_FILE_V1_CONSTANTS.fileFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      generationMetadata,
    );
    const decrypted = await this.cryptoProvider.subtle.decrypt(
      {
        name: LEDGER_FILE_V1_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_V1_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(ciphertext),
    );

    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
