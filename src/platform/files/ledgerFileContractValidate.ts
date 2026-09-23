import { base64UrlToBytes } from "@/platform/encryption";
import type {
  EncryptedLedgerGenerationV4,
  LedgerFileV2,
  LedgerFileContractError,
  LedgerFileValidationResult,
} from "./ledgerFileContract";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
} from "./ledgerFileContract";
import {
  FILE_KEYS,
  CRYPTO_KEYS,
  KDF_KEYS,
  CIPHER_KEYS,
  GENERATION_KEYS,
} from "./ledgerFileContractConstants";
import { isExactObject, failure } from "./ledgerFileContractShared";

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

  let previous: EncryptedLedgerGenerationV4 | null = null;
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

function validateGeneration(
  input: unknown,
  path: "current" | "previous",
):
  | { ok: true; value: EncryptedLedgerGenerationV4 }
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
      input.ledgerSchemaVersion === 4
        ? "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4"
        : "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
      `${path}.ledgerSchemaVersion`,
      input.ledgerSchemaVersion === 4
        ? "This file contains a V4 ledger; V5 does not provide migration"
        : input.ledgerSchemaVersion === 2 || input.ledgerSchemaVersion === 3
        ? `This file contains a V${input.ledgerSchemaVersion} ledger; V5 does not provide migration`
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
    value: input as EncryptedLedgerGenerationV4,
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
