import { base64UrlToBytes } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import type {
  LedgerFileV3S1,
  EncryptedLedgerGenerationV3S1,
  LedgerFileV3ValidationResult,
} from "./ledgerFileContainerV3";
import {
  LEDGER_FILE_V3_MAGIC,
  LEDGER_FILE_OUTER_V3_CONSTANTS,
  isLedgerFileV3Bytes,
} from "./ledgerFileContainerV3";
import {
  HEADER_KEYS,
  GENERATION_HEADER_KEYS,
  CRYPTO_KEYS,
  KDF_KEYS,
  CIPHER_KEYS,
  GENERATION_KEYS,
} from "./ledgerFileContainerV3Constants";
import type {
  LedgerFileGenerationHeaderV3S1,
  LedgerFileHeaderV3S1,
} from "./ledgerFileContainerV3Header";
import {
  invalidVersion,
  invalid,
  failure,
  isTechnicalId,
  isRecord,
  isExactObject,
} from "./ledgerFileContainerV3Shared";

export function parseLedgerFileV3S1(
  bytes: Uint8Array,
): LedgerFileV3ValidationResult {
  if (!isLedgerFileV3Bytes(bytes)) {
    return invalid("file", "Ledger file does not use the V3 binary magic");
  }
  const prefixBytes =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  if (bytes.byteLength < prefixBytes) {
    return invalid("file", "Ledger file V3 prefix is truncated");
  }
  if (bytes.byteLength > LEDGER_FILE_OUTER_V3_CONSTANTS.maximumFileBytes) {
    return invalid("file", "Ledger file V3 exceeds its outer byte limit");
  }

  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  if (
    headerLength === 0 ||
    headerLength > LEDGER_FILE_OUTER_V3_CONSTANTS.maximumHeaderBytes ||
    prefixBytes + headerLength > bytes.byteLength
  ) {
    return invalid("header", "Ledger file V3 header length is invalid");
  }

  let parsed: unknown;
  try {
    const headerText = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(prefixBytes, prefixBytes + headerLength),
    );
    parsed = JSON.parse(headerText);
  } catch (error) {
    return invalid(
      "header",
      "Ledger file V3 header is not valid UTF-8 JSON",
      error,
    );
  }

  const headerResult = validateHeader(parsed);
  if (!headerResult.ok) return headerResult;
  const header = headerResult.value;
  const currentStart = prefixBytes + headerLength;
  const previousLength = header.previous?.ciphertextByteLength ?? 0;
  const expectedLength =
    currentStart +
    header.current.ciphertextByteLength +
    previousLength;
  if (expectedLength !== bytes.byteLength) {
    return invalid(
      "file",
      "Ledger file V3 body length does not exactly match its header",
    );
  }

  const currentCiphertext = bytes.subarray(
    currentStart,
    currentStart + header.current.ciphertextByteLength,
  );
  const previousCiphertext = header.previous
    ? bytes.subarray(
        currentStart + header.current.ciphertextByteLength,
        expectedLength,
      )
    : null;
  const file: LedgerFileV3S1 = {
    fileFormatVersion: header.fileFormatVersion,
    cryptoVersion: header.cryptoVersion,
    ledgerSchemaVersion: header.ledgerSchemaVersion,
    backupFormatVersion: header.backupFormatVersion,
    fileId: header.fileId,
    crypto: header.crypto,
    current: {
      revisionId: header.current.revisionId,
      parentRevisionId: header.current.parentRevisionId,
      ledgerSchemaVersion: header.current.ledgerSchemaVersion,
      ivBase64Url: header.current.ivBase64Url,
      ciphertextBytes: Uint8Array.from(currentCiphertext),
    },
    previous:
      header.previous && previousCiphertext
        ? {
            revisionId: header.previous.revisionId,
            parentRevisionId: header.previous.parentRevisionId,
            ledgerSchemaVersion: header.previous.ledgerSchemaVersion,
            ivBase64Url: header.previous.ivBase64Url,
            ciphertextBytes: Uint8Array.from(previousCiphertext),
          }
        : null,
  };
  return validateLedgerFileV3S1(file);
}

export function validateLedgerFileV3S1(
  input: unknown,
): LedgerFileV3ValidationResult {
  if (!isExactObject(input, HEADER_KEYS)) {
    return invalid(
      "file",
      "Ledger file must contain exactly the V3 S-1 logical fields",
    );
  }
  if (
    input.fileFormatVersion !==
      LEDGER_FILE_OUTER_V3_CONSTANTS.fileFormatVersion ||
    input.cryptoVersion !== LEDGER_FILE_OUTER_V3_CONSTANTS.cryptoVersion ||
    input.ledgerSchemaVersion !==
      LEDGER_FILE_OUTER_V3_CONSTANTS.ledgerSchemaVersion ||
    input.backupFormatVersion !==
      LEDGER_FILE_OUTER_V3_CONSTANTS.backupFormatVersion
  ) {
    return invalidVersion();
  }
  if (!isTechnicalId(input.fileId)) {
    return invalid(
      "fileId",
      "Ledger file V3 fileId must be a bounded technical identifier",
    );
  }
  if (!isExactObject(input.crypto, CRYPTO_KEYS)) {
    return invalid("crypto", "Ledger file V3 crypto metadata is invalid");
  }
  const crypto = input.crypto;
  if (
    !isExactObject(crypto.kdf, KDF_KEYS) ||
    !isExactObject(crypto.cipher, CIPHER_KEYS)
  ) {
    return invalid("crypto", "Ledger file V3 crypto metadata is invalid");
  }
  if (
    crypto.cryptoVersion !== input.cryptoVersion ||
    crypto.kdf.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName ||
    crypto.kdf.hash !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash ||
    crypto.kdf.iterations !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations ||
    crypto.cipher.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName ||
    crypto.cipher.keyLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength ||
    crypto.cipher.tagLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength
  ) {
    return failure(
      "LEDGER_FILE_INVALID_CRYPTO_PARAMETERS",
      "crypto",
      "Ledger file V3 crypto parameters are unsupported",
    );
  }
  if (typeof crypto.kdf.saltBase64Url !== "string") {
    return invalid(
      "crypto.kdf.saltBase64Url",
      "Ledger file V3 salt must be canonical Base64URL",
    );
  }
  try {
    if (
      base64UrlToBytes(crypto.kdf.saltBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.saltBytes
    ) {
      return failure(
        "LEDGER_FILE_INVALID_ENCODING",
        "crypto.kdf.saltBase64Url",
        "Ledger file V3 salt must decode to 16 bytes",
      );
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      "crypto.kdf.saltBase64Url",
      "Ledger file V3 salt must be canonical Base64URL",
      error,
    );
  }

  const currentResult = validateGeneration(input.current, "current");
  if (!currentResult.ok) return currentResult;
  let previous: EncryptedLedgerGenerationV3S1 | null = null;
  if (input.previous !== null) {
    const previousResult = validateGeneration(input.previous, "previous");
    if (!previousResult.ok) return previousResult;
    previous = previousResult.value;
  }
  const current = currentResult.value;
  if (previous === null) {
    if (current.parentRevisionId !== null) {
      return failure(
        "LEDGER_FILE_INVALID_REVISION_CHAIN",
        "current.parentRevisionId",
        "The first V3 generation must not have a parent revision",
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
      "Current and previous V3 generations are not adjacent independent revisions",
    );
  }
  return {
    ok: true,
    value: input as LedgerFileV3S1,
  };
}

function validateGeneration(
  input: unknown,
  path: "current" | "previous",
):
  | { ok: true; value: EncryptedLedgerGenerationV3S1 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, GENERATION_KEYS)) {
    return invalid(path, `${path} V3 generation fields are invalid`);
  }
  if (input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION) {
    return failure(
      input.ledgerSchemaVersion === 4
        ? "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4"
        : "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
      `${path}.ledgerSchemaVersion`,
      input.ledgerSchemaVersion === 4
        ? "This file contains a V4 ledger; V5 does not provide migration"
        : typeof input.ledgerSchemaVersion === "number" &&
        (input.ledgerSchemaVersion === 2 || input.ledgerSchemaVersion === 3)
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
    !(input.ciphertextBytes instanceof Uint8Array)
  ) {
    return invalid(path, `${path} contains invalid V3 revision metadata`);
  }
  try {
    const iv = base64UrlToBytes(input.ivBase64Url);
    if (
      iv.byteLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes ||
      input.ciphertextBytes.byteLength <
        LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
      input.ciphertextBytes.byteLength >
        LEDGER_FILE_OUTER_V2_CONSTANTS.maximumCiphertextBytes
    ) {
      return failure(
        "LEDGER_FILE_INVALID_ENCODING",
        path,
        `${path} V3 IV or ciphertext length is outside the contract`,
      );
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      path,
      `${path} V3 IV and ciphertext must be canonical Base64URL`,
      error,
    );
  }
  return {
    ok: true,
    value: input as EncryptedLedgerGenerationV3S1,
  };
}

function validateHeader(
  input: unknown,
):
  | { ok: true; value: LedgerFileHeaderV3S1 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, HEADER_KEYS)) {
    return invalid("header", "Ledger file V3 header fields are invalid");
  }
  if (
    input.fileFormatVersion !==
      LEDGER_FILE_OUTER_V3_CONSTANTS.fileFormatVersion ||
    input.cryptoVersion !== LEDGER_FILE_OUTER_V3_CONSTANTS.cryptoVersion ||
    input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION ||
    input.backupFormatVersion !==
      LEDGER_FILE_OUTER_V3_CONSTANTS.backupFormatVersion
  ) {
    return invalidVersion();
  }
  if (!isRecord(input.crypto) || input.crypto.cryptoVersion !== 1) {
    return invalid("crypto", "Ledger file V3 crypto metadata is invalid");
  }
  const current = validateGenerationHeader(input.current, "current");
  if (!current.ok) return current;
  let previous: LedgerFileGenerationHeaderV3S1 | null = null;
  if (input.previous !== null) {
    const previousResult = validateGenerationHeader(
      input.previous,
      "previous",
    );
    if (!previousResult.ok) return previousResult;
    previous = previousResult.value;
  }
  return {
    ok: true,
    value: {
      fileFormatVersion: 3,
      cryptoVersion: 1,
      ledgerSchemaVersion: 5,
      backupFormatVersion: 3,
      fileId: input.fileId as string,
      crypto: input.crypto as LedgerFileCryptoV2,
      current: current.value,
      previous,
    },
  };
}

function validateGenerationHeader(
  input: unknown,
  path: "current" | "previous",
):
  | { ok: true; value: LedgerFileGenerationHeaderV3S1 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (
    !isExactObject(input, GENERATION_HEADER_KEYS) ||
    !Number.isSafeInteger(input.ciphertextByteLength) ||
    (input.ciphertextByteLength as number) <
      LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
    (input.ciphertextByteLength as number) >
      LEDGER_FILE_OUTER_V2_CONSTANTS.maximumCiphertextBytes
  ) {
    return invalid(path, `${path} V3 ciphertext length is invalid`);
  }
  return {
    ok: true,
    value: input as LedgerFileGenerationHeaderV3S1,
  };
}
