import { base64UrlToBytes, bytesToBase64Url } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  createLedgerFileCryptoV2,
  createLedgerFileGenerationAadV2,
  type EncryptedLedgerGenerationV3,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import {
  deriveLedgerKeyWithParameters,
  type CryptoProvider,
} from "@/platform/encryption";

const LEDGER_FILE_V2_KEY_DERIVATION_PARAMETERS = {
  kdfName: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName,
  kdfHash: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash,
  kdfIterations: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations,
  cipherName: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
  keyLength: LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength,
} as const;

export class LedgerFileCrypto {
  private constructor(
    private readonly key: CryptoKey,
    private readonly metadata: LedgerFileCryptoV2,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  static async createForSetup(
    passphrase: string,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<LedgerFileCrypto> {
    const salt = cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_OUTER_V2_CONSTANTS.saltBytes),
    );
    const key = await deriveLedgerKeyWithParameters(
      passphrase,
      salt,
      LEDGER_FILE_V2_KEY_DERIVATION_PARAMETERS,
      cryptoProvider,
    );
    return new LedgerFileCrypto(
      key,
      createLedgerFileCryptoV2(bytesToBase64Url(salt)),
      cryptoProvider,
    );
  }

  static async createForUnlock(
    passphrase: string,
    metadata: LedgerFileCryptoV2,
    cryptoProvider: CryptoProvider = globalThis.crypto,
  ): Promise<LedgerFileCrypto> {
    const salt = base64UrlToBytes(metadata.kdf.saltBase64Url);
    if (salt.byteLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.saltBytes) {
      throw new Error("Invalid ledger file salt");
    }

    const key = await deriveLedgerKeyWithParameters(
      passphrase,
      salt,
      LEDGER_FILE_V2_KEY_DERIVATION_PARAMETERS,
      cryptoProvider,
    );
    return new LedgerFileCrypto(
      key,
      cloneLedgerFileCryptoMetadata(metadata),
      cryptoProvider,
    );
  }

  getCryptoMetadata(): LedgerFileCryptoV2 {
    return cloneLedgerFileCryptoMetadata(this.metadata);
  }

  matchesCryptoMetadata(metadata: LedgerFileCryptoV2): boolean {
    return sameLedgerFileCryptoMetadata(this.metadata, metadata);
  }

  async encryptGeneration(
    fileId: string,
    revision: {
      revisionId: string;
      parentRevisionId: string | null;
      ledgerSchemaVersion: typeof SUPPORTED_LEDGER_SCHEMA_VERSION;
    },
    serializedPayload: string,
  ): Promise<EncryptedLedgerGenerationV3> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes),
    );
    const generationMetadata = {
      ...revision,
      ivBase64Url: bytesToBase64Url(iv),
    };
    const additionalData = createLedgerFileGenerationAadV2(
      {
        fileFormatVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.fileFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      generationMetadata,
    );
    const encrypted = await this.cryptoProvider.subtle.encrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
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
    generation: EncryptedLedgerGenerationV3,
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
    const additionalData = createLedgerFileGenerationAadV2(
      {
        fileFormatVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.fileFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      generationMetadata,
    );
    const decrypted = await this.cryptoProvider.subtle.decrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(ciphertext),
    );

    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  }
}

export function sameLedgerFileCryptoMetadata(
  left: LedgerFileCryptoV2,
  right: LedgerFileCryptoV2,
): boolean {
  return (
    left.cryptoVersion === right.cryptoVersion &&
    left.kdf.name === right.kdf.name &&
    left.kdf.hash === right.kdf.hash &&
    left.kdf.iterations === right.kdf.iterations &&
    left.kdf.saltBase64Url === right.kdf.saltBase64Url &&
    left.cipher.name === right.cipher.name &&
    left.cipher.keyLength === right.cipher.keyLength &&
    left.cipher.tagLength === right.cipher.tagLength
  );
}

function cloneLedgerFileCryptoMetadata(
  metadata: LedgerFileCryptoV2,
): LedgerFileCryptoV2 {
  return {
    cryptoVersion: metadata.cryptoVersion,
    kdf: { ...metadata.kdf },
    cipher: { ...metadata.cipher },
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
