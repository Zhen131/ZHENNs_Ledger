import type { LedgerData } from "@/core/models";
import {
  DEFAULT_LEDGER_RESOURCE_LIMITS,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { isValidISODateOrDateTime } from "@/core/validation";
import {
  selectLedgerDataFacts,
  validateLedgerData,
} from "@/core/validation";
import { base64UrlToBytes } from "@/platform/encryption";

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

export const SUPPORTED_LEDGER_SCHEMA_VERSION = 3 as const;

export const MAX_LEDGER_FILE_V2_BYTES = 32 * 1024 * 1024;

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

export type EncryptedLedgerGenerationV3 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 3;
  ivBase64Url: string;
  ciphertextBase64Url: string;
};

export type LedgerFileV2 = {
  fileFormatVersion: 2;
  fileId: string;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3;
  previous: EncryptedLedgerGenerationV3 | null;
};

export type DecryptedLedgerPayloadV3 = {
  savedAt: string;
  ledgerData: LedgerData;
};

export type CanonicalLedgerPayloadV3 = {
  value: DecryptedLedgerPayloadV3;
  serializedPayload: string;
  serializedLedgerData: string;
};

export type LedgerFileContractErrorCode =
  | "LEDGER_FILE_INVALID_STRUCTURE"
  | "LEDGER_FILE_UNSUPPORTED_VERSION"
  | "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA"
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
  | { ok: true; value: CanonicalLedgerPayloadV3 }
  | { ok: false; errors: LedgerFileContractError[] };

const FILE_KEYS = [
  "crypto",
  "current",
  "fileFormatVersion",
  "fileId",
  "previous",
] as const;
const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
const KDF_KEYS = [
  "hash",
  "iterations",
  "name",
  "saltBase64Url",
] as const;
const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
const GENERATION_KEYS = [
  "ciphertextBase64Url",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
const PAYLOAD_KEYS = ["ledgerData", "savedAt"] as const;
const LEDGER_DATA_KEYS = [
  "assets",
  "cashEvents",
  "feeRules",
  "priceSnapshots",
  "schemaVersion",
  "trades",
] as const;

export function validateLedgerFileV2(
  input: unknown,
): LedgerFileValidationResult {
  if (!isExactObject(input, FILE_KEYS)) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      "file",
      "Ledger file must contain exactly the V2 top-level fields",
    );
  }

  if (input.fileFormatVersion !== LEDGER_FILE_OUTER_V2_CONSTANTS.fileFormatVersion) {
    return failure(
      "LEDGER_FILE_UNSUPPORTED_VERSION",
      "fileFormatVersion",
      "Unsupported ledger file format version",
    );
  }

  if (!isTechnicalId(input.fileId)) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      "fileId",
      "fileId must be a non-empty bounded technical identifier",
    );
  }

  if (!isExactObject(input.crypto, CRYPTO_KEYS)) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      "crypto",
      "Ledger file crypto metadata must use the exact V2 shape",
    );
  }

  const crypto = input.crypto;
  if (
    !isExactObject(crypto.kdf, KDF_KEYS) ||
    !isExactObject(crypto.cipher, CIPHER_KEYS)
  ) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      "crypto",
      "Ledger file crypto metadata must use the exact V2 shape",
    );
  }
  const kdf = crypto.kdf;
  const cipher = crypto.cipher;
  if (
    crypto.cryptoVersion !== LEDGER_FILE_OUTER_V2_CONSTANTS.cryptoVersion ||
    kdf.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName ||
    kdf.hash !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash ||
    kdf.iterations !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations ||
    cipher.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName ||
    cipher.keyLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength ||
    cipher.tagLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength
  ) {
    return failure(
      "LEDGER_FILE_INVALID_CRYPTO_PARAMETERS",
      "crypto",
      "Ledger file crypto parameters are unsupported",
    );
  }

  if (typeof kdf.saltBase64Url !== "string") {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      "crypto.kdf.saltBase64Url",
      "Ledger file salt must be canonical Base64URL",
    );
  }

  try {
    if (
      base64UrlToBytes(kdf.saltBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.saltBytes
    ) {
      return failure(
        "LEDGER_FILE_INVALID_ENCODING",
        "crypto.kdf.saltBase64Url",
        "Ledger file salt must decode to 16 bytes",
      );
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      "crypto.kdf.saltBase64Url",
      "Ledger file salt must be canonical Base64URL",
      error,
    );
  }

  const currentResult = validateGeneration(input.current, "current");
  if (!currentResult.ok) {
    return currentResult;
  }

  let previous: EncryptedLedgerGenerationV3 | null = null;
  if (input.previous !== null) {
    const previousResult = validateGeneration(input.previous, "previous");
    if (!previousResult.ok) {
      return previousResult;
    }
    previous = previousResult.value;
  }

  const current = currentResult.value;
  if (previous === null) {
    if (current.parentRevisionId !== null) {
      return failure(
        "LEDGER_FILE_INVALID_REVISION_CHAIN",
        "current.parentRevisionId",
        "The first generation must not have a parent revision",
      );
    }
  } else if (
    current.revisionId === previous.revisionId ||
    current.parentRevisionId !== previous.revisionId ||
    current.ivBase64Url === previous.ivBase64Url
  ) {
    return failure(
      "LEDGER_FILE_INVALID_REVISION_CHAIN",
      "current",
      "Current and previous generations are not adjacent independent revisions",
    );
  }

  return {
    ok: true,
    value: input as LedgerFileV2,
  };
}

export function createCanonicalLedgerPayloadV3(
  ledgerData: unknown,
  savedAt: string,
): LedgerFilePayloadValidationResult {
  if (
    !savedAt.includes("T") ||
    !isValidISODateOrDateTime(savedAt)
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "savedAt",
      "savedAt must be a strict ISO datetime with timezone",
    );
  }

  const ledgerResult = validateLedgerData(selectLedgerDataFacts(ledgerData));
  if (!ledgerResult.ok) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "ledgerData",
      "LedgerData failed runtime validation",
      ledgerResult.errors,
    );
  }

  const resourceResult = evaluateLedgerResourcePolicy(ledgerResult.value);
  if (!resourceResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "ledgerData",
      "LedgerData exceeds collection or string resource limits",
      resourceResult.errors,
    );
  }

  const value: DecryptedLedgerPayloadV3 = {
    savedAt,
    ledgerData: ledgerResult.value,
  };
  const serializedLedgerData = JSON.stringify(ledgerResult.value);
  const serializedPayload = JSON.stringify(value);
  const byteResult =
    evaluateLedgerFilePayloadByteLength(serializedPayload);

  if (!byteResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "payload",
      "Ledger file generation payload exceeds the 8 MiB limit",
      byteResult.errors,
    );
  }

  return {
    ok: true,
    value: {
      value,
      serializedPayload,
      serializedLedgerData,
    },
  };
}

export function evaluateLedgerFilePayloadByteLength(
  serializedPayload: string,
) {
  return evaluateLedgerJsonResourcePolicy(serializedPayload);
}

export function validateDecryptedLedgerPayloadV3(
  input: unknown,
): LedgerFilePayloadValidationResult {
  if (
    !isExactObject(input, PAYLOAD_KEYS) ||
    !isExactObject(input.ledgerData, LEDGER_DATA_KEYS) ||
    typeof input.savedAt !== "string"
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "payload",
      "Decrypted payload must contain exactly savedAt and LedgerData facts",
    );
  }

  return createCanonicalLedgerPayloadV3(input.ledgerData, input.savedAt);
}

export function createLedgerFileGenerationAadV2(
  file: Pick<
    LedgerFileV2,
    "fileFormatVersion" | "fileId" | "crypto"
  >,
  generation: Omit<
    EncryptedLedgerGenerationV3,
    "ciphertextBase64Url"
  >,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    fileId: file.fileId,
    crypto: {
      cryptoVersion: file.crypto.cryptoVersion,
      kdf: {
        name: file.crypto.kdf.name,
        hash: file.crypto.kdf.hash,
        iterations: file.crypto.kdf.iterations,
        saltBase64Url: file.crypto.kdf.saltBase64Url,
      },
      cipher: {
        name: file.crypto.cipher.name,
        keyLength: file.crypto.cipher.keyLength,
        tagLength: file.crypto.cipher.tagLength,
      },
    },
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    },
  };

  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function createLedgerFileCryptoV2(
  saltBase64Url: string,
): LedgerFileCryptoV2 {
  return {
    cryptoVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.cryptoVersion,
    kdf: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName,
      hash: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash,
      iterations: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations,
      saltBase64Url,
    },
    cipher: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
      keyLength: LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength,
      tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
    },
  };
}

function validateGeneration(
  input: unknown,
  path: "current" | "previous",
):
  | { ok: true; value: EncryptedLedgerGenerationV3 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, GENERATION_KEYS)) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      path,
      `${path} must use the exact V2 generation shape`,
    );
  }

  if (input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION) {
    return failure(
      "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
      `${path}.ledgerSchemaVersion`,
      input.ledgerSchemaVersion === 2
        ? "This file contains a V2 ledger; V3 does not provide migration"
        : "The ledger schema version is unsupported",
    );
  }

  if (
    !isTechnicalId(input.revisionId) ||
    !(
      input.parentRevisionId === null ||
      isTechnicalId(input.parentRevisionId)
    ) ||
    typeof input.ivBase64Url !== "string" ||
    typeof input.ciphertextBase64Url !== "string"
  ) {
    return failure(
      "LEDGER_FILE_INVALID_STRUCTURE",
      path,
      `${path} contains invalid revision or schema metadata`,
    );
  }

  try {
    const iv = base64UrlToBytes(input.ivBase64Url);
    const ciphertext = base64UrlToBytes(input.ciphertextBase64Url);
    if (
      iv.byteLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes ||
      ciphertext.byteLength <
        LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
      ciphertext.byteLength >
        LEDGER_FILE_OUTER_V2_CONSTANTS.maximumCiphertextBytes
    ) {
      return failure(
        "LEDGER_FILE_INVALID_ENCODING",
        path,
        `${path} IV or ciphertext length is outside the V2 contract`,
      );
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      path,
      `${path} IV and ciphertext must be canonical Base64URL`,
      error,
    );
  }

  return {
    ok: true,
    value: input as EncryptedLedgerGenerationV3,
  };
}

function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function failure(
  code: LedgerFileContractErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): { ok: false; errors: LedgerFileContractError[] } {
  return {
    ok: false,
    errors: [{ code, path, message, ...(cause === undefined ? {} : { cause }) }],
  };
}
