import type { LedgerData } from "@/core/models";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "@/core/validation";

export const LEDGER_FILE_OUTER_V2_CONSTANTS = {
  fileFormatVersion: 2,
  cryptoVersion: 1,
  kdfName: "PBKDF2",
  kdfHash: "SHA-256",
  kdfIterations: 600_000,
  saltBytes: 16,
  cipherName: "AES-GCM",
  keyLength: 256,
  ivBytes: 12,
  tagLength: 128,
  minimumCiphertextBytes: 16,
  maximumCiphertextBytes:
    DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 16,
  maximumTechnicalIdLength: DEFAULT_LEDGER_RESOURCE_LIMITS.id,
} as const;

export const SUPPORTED_LEDGER_SCHEMA_VERSION = 5 as const;

export const MAX_LEDGER_FILE_V2_BYTES = 384 * 1024 * 1024;

export type LedgerFileCryptoV2 = {
  cryptoVersion: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 600000;
    saltBase64Url: string;
  };
  cipher: {
    name: "AES-GCM";
    keyLength: 256;
    tagLength: 128;
  };
};

export type EncryptedLedgerGenerationV4 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  ciphertextBase64Url: string;
};

export type LedgerFileV2 = {
  fileFormatVersion: 2;
  fileId: string;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV4;
  previous: EncryptedLedgerGenerationV4 | null;
};

export type DecryptedLedgerPayloadV4 = {
  savedAt: string;
  ledgerData: LedgerData;
};

export type CanonicalLedgerPayloadV4 = {
  value: DecryptedLedgerPayloadV4;
  serializedPayload: string;
  serializedLedgerData: string;
};

export type LedgerFileContractErrorCode =
  | "LEDGER_FILE_INVALID_STRUCTURE"
  | "LEDGER_FILE_UNSUPPORTED_VERSION"
  | "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA"
  | "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4"
  | "LEDGER_FILE_INVALID_CRYPTO_PARAMETERS"
  | "LEDGER_FILE_INVALID_ENCODING"
  | "LEDGER_FILE_INVALID_REVISION_CHAIN"
  | "LEDGER_FILE_INVALID_PAYLOAD"
  | "LEDGER_FILE_RESOURCE_POLICY_FAILED";

export type LedgerFileContractError = {
  code: LedgerFileContractErrorCode;
  path: string;
  message: string;
  cause?: unknown;
};

export type LedgerFileValidationResult =
  | { ok: true; value: LedgerFileV2 }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFilePayloadValidationResult =
  | { ok: true; value: CanonicalLedgerPayloadV4 }
  | { ok: false; errors: LedgerFileContractError[] };
