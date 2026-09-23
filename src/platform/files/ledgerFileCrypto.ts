import { base64UrlToBytes, bytesToBase64Url } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  createLedgerFileCryptoV2,
  createLedgerFileGenerationAadV2,
  type EncryptedLedgerGenerationV4,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import {
  deriveLedgerKeyWithParameters,
  type CryptoProvider,
} from "@/platform/encryption";
import {
  createLedgerFileGenerationAadV3S1,
  LEDGER_FILE_OUTER_V3_CONSTANTS,
  type EncryptedLedgerGenerationV3S1,
} from "./ledgerFileContainerV3";
import {
  createLedgerFileGenerationAadV3S2,
  LEDGER_FILE_OUTER_V3_S2_CONSTANTS,
  type EncryptedLedgerGenerationV3S2,
  type LedgerFileBodySlotV3S2,
} from "./ledgerFileSlotContainerV3";
import {
  LEDGER_FILE_OUTER_V3_S3_CONSTANTS,
  type EncryptedLedgerBlockV3S3,
  type LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  createLedgerFileBlockAadV3S3,
  createLedgerFileManifestAadV3S3,
} from "./ledgerFileChunkedContainerV3Aad";

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
  ): Promise<EncryptedLedgerGenerationV4> {
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
    generation: EncryptedLedgerGenerationV4,
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

  async encryptGenerationV3S1(
    fileId: string,
    revision: {
      revisionId: string;
      parentRevisionId: string | null;
      ledgerSchemaVersion: typeof SUPPORTED_LEDGER_SCHEMA_VERSION;
    },
    serializedPayload: string,
  ): Promise<EncryptedLedgerGenerationV3S1> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes),
    );
    const generationMetadata = {
      ...revision,
      ivBase64Url: bytesToBase64Url(iv),
    };
    const additionalData = createLedgerFileGenerationAadV3S1(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.fileFormatVersion,
        cryptoVersion: LEDGER_FILE_OUTER_V3_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.backupFormatVersion,
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
      ciphertextBytes: new Uint8Array(encrypted),
    };
  }

  async decryptGenerationV3S1(
    fileId: string,
    generation: EncryptedLedgerGenerationV3S1,
  ): Promise<string> {
    const iv = base64UrlToBytes(generation.ivBase64Url);
    const ciphertext = generation.ciphertextBytes;
    const generationMetadata = {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    };
    const additionalData = createLedgerFileGenerationAadV3S1(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.fileFormatVersion,
        cryptoVersion: LEDGER_FILE_OUTER_V3_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_CONSTANTS.backupFormatVersion,
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

  async encryptGenerationV3S2(
    fileId: string,
    revision: {
      revisionId: string;
      parentRevisionId: string | null;
      ledgerSchemaVersion: typeof SUPPORTED_LEDGER_SCHEMA_VERSION;
      bodySlot: LedgerFileBodySlotV3S2;
    },
    serializedPayload: string,
  ): Promise<EncryptedLedgerGenerationV3S2> {
    const iv = this.cryptoProvider.getRandomValues(
      new Uint8Array(LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes),
    );
    const generationMetadata = {
      ...revision,
      ivBase64Url: bytesToBase64Url(iv),
    };
    const additionalData = createLedgerFileGenerationAadV3S2(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.fileFormatVersion,
        cryptoVersion: LEDGER_FILE_OUTER_V3_S2_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.backupFormatVersion,
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
      ciphertextBytes: new Uint8Array(encrypted),
    };
  }

  async decryptGenerationV3S2(
    fileId: string,
    generation: EncryptedLedgerGenerationV3S2,
  ): Promise<string> {
    const iv = base64UrlToBytes(generation.ivBase64Url);
    const generationMetadata = {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      bodySlot: generation.bodySlot,
      ivBase64Url: generation.ivBase64Url,
    };
    const additionalData = createLedgerFileGenerationAadV3S2(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.fileFormatVersion,
        cryptoVersion: LEDGER_FILE_OUTER_V3_S2_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_S2_CONSTANTS.backupFormatVersion,
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
      toArrayBuffer(generation.ciphertextBytes),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  }

  createIvBase64UrlV3S3(
    forbidden: ReadonlySet<string> = new Set(),
  ): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = bytesToBase64Url(
        this.cryptoProvider.getRandomValues(
          new Uint8Array(LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes),
        ),
      );
      if (!forbidden.has(candidate)) return candidate;
    }
    throw new Error("Could not allocate a unique V3 S-3 IV");
  }

  async encryptBlockV3S3(
    fileId: string,
    metadata: Omit<
      EncryptedLedgerBlockV3S3,
      "ivBase64Url" | "ciphertextBytes"
    >,
    serializedPayload: string,
    forbiddenIvBase64Urls: ReadonlySet<string> = new Set(),
  ): Promise<EncryptedLedgerBlockV3S3> {
    const plaintext = new TextEncoder().encode(serializedPayload);
    if (plaintext.byteLength !== metadata.plaintextByteLength) {
      throw new Error("V3 S-3 block plaintext length changed before encryption");
    }
    const ivBase64Url = this.createIvBase64UrlV3S3(
      forbiddenIvBase64Urls,
    );
    const iv = base64UrlToBytes(ivBase64Url);
    const blockMetadata = { ...metadata, ivBase64Url };
    const additionalData = createLedgerFileBlockAadV3S3(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.fileFormatVersion,
        cryptoVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.backupFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      blockMetadata,
    );
    const encrypted = await this.cryptoProvider.subtle.encrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(plaintext),
    );
    return {
      ...blockMetadata,
      ciphertextBytes: new Uint8Array(encrypted),
    };
  }

  async decryptBlockV3S3(
    fileId: string,
    block: EncryptedLedgerBlockV3S3,
  ): Promise<string> {
    const iv = base64UrlToBytes(block.ivBase64Url);
    const {
      ciphertextBytes,
      ...blockMetadata
    } = block;
    const additionalData = createLedgerFileBlockAadV3S3(
      {
        fileFormatVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.fileFormatVersion,
        cryptoVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.cryptoVersion,
        ledgerSchemaVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.ledgerSchemaVersion,
        backupFormatVersion:
          LEDGER_FILE_OUTER_V3_S3_CONSTANTS.backupFormatVersion,
        fileId,
        crypto: this.metadata,
      },
      blockMetadata,
    );
    const decrypted = await this.cryptoProvider.subtle.decrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(ciphertextBytes),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  }

  async authenticateManifestV3S3(
    file: LedgerFileV3S3,
  ): Promise<Uint8Array> {
    const iv = base64UrlToBytes(file.manifestAuthIvBase64Url);
    const encrypted = await this.cryptoProvider.subtle.encrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(createLedgerFileManifestAadV3S3(file)),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
      },
      this.key,
      new ArrayBuffer(0),
    );
    return new Uint8Array(encrypted);
  }

  async verifyManifestV3S3(file: LedgerFileV3S3): Promise<void> {
    const iv = base64UrlToBytes(file.manifestAuthIvBase64Url);
    await this.cryptoProvider.subtle.decrypt(
      {
        name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(createLedgerFileManifestAadV3S3(file)),
        tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
      },
      this.key,
      toArrayBuffer(file.manifestAuthTagBytes),
    );
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
