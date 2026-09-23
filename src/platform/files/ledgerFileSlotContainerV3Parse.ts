import { base64UrlToBytes } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import type {
  LedgerFileHeaderSlotV3S2,
  LedgerFileBodySlotV3S2,
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
  LedgerFileV3S2ValidationResult,
  LedgerFileV3S2HeaderSlotState,
  LedgerFileV3S2CandidatesResult,
} from "./ledgerFileSlotContainerV3";
import {
  LEDGER_FILE_HEADER_SLOT_BYTES,
  LEDGER_FILE_BODY_SLOT_COUNT,
  LEDGER_FILE_OUTER_V3_S2_CONSTANTS,
  isLedgerFileV3S2Bytes,
  ledgerFileHeaderSlotOffsetV3S2,
  ledgerFileBodySlotOffsetV3S2,
} from "./ledgerFileSlotContainerV3";
import {
  PREFIX_BYTES,
  HEADER_JSON_LENGTH_BYTES,
  LOGICAL_FILE_KEYS,
  HEADER_KEYS,
  GENERATION_KEYS,
  GENERATION_HEADER_KEYS,
  CRYPTO_KEYS,
  KDF_KEYS,
  CIPHER_KEYS,
} from "./ledgerFileSlotContainerV3Constants";
import type {
  LedgerFileGenerationHeaderV3S2,
  LedgerFileHeaderV3S2,
} from "./ledgerFileSlotContainerV3Header";
import {
  expectedFileByteLength,
  isValidBodySlotBytes,
  isHeaderSlot,
  isBodySlot,
  isTechnicalId,
  invalidVersion,
  invalid,
  failure,
  isExactObject,
} from "./ledgerFileSlotContainerV3Shared";

export function parseLedgerFileV3S2(
  bytes: Uint8Array,
): LedgerFileV3S2ValidationResult {
  const parsed = parseLedgerFileV3S2Candidates(bytes);
  if (!parsed.ok) return parsed;
  const candidates = parsed.value.candidates
    .filter(
      (candidate) =>
        candidate.currentPaddingIsZero && candidate.previousPaddingIsZero,
    )
    .sort((left, right) => right.file.sequence - left.file.sequence);
  const selected = candidates[0];
  if (!selected) {
    return invalid(
      "header",
      "Ledger file V3 S-2 has no complete header candidate",
    );
  }
  if (
    candidates[1] &&
    candidates[1].file.sequence === selected.file.sequence
  ) {
    return invalid(
      "header.sequence",
      "Ledger file V3 S-2 header sequences must be unique",
    );
  }
  return { ok: true, value: selected.file };
}

export function parseLedgerFileV3S2Candidates(
  bytes: Uint8Array,
): LedgerFileV3S2CandidatesResult {
  const outer = validateOuterLayout(bytes);
  if (!outer.ok) return outer;
  const headerSlots = [0, 1].map((slot) =>
    parseHeaderSlot(
      bytes,
      slot as LedgerFileHeaderSlotV3S2,
      outer.value.bodySlotBytes,
    ),
  ) as [LedgerFileV3S2HeaderSlotState, LedgerFileV3S2HeaderSlotState];
  const candidates = headerSlots.flatMap((state) =>
    state.status === "candidate" ? [state.candidate] : [],
  );
  if (candidates.length === 0) {
    const errors = headerSlots.flatMap((state) =>
      state.status === "invalid" ? state.errors : [],
    );
    return {
      ok: false,
      errors:
        errors.length > 0
          ? errors
          : invalid("header", "Ledger file V3 S-2 has no header").errors,
    };
  }
  const identity = candidates[0]!.file;
  for (const candidate of candidates.slice(1)) {
    const file = candidate.file;
    if (
      file.fileId !== identity.fileId ||
      file.cryptoVersion !== identity.cryptoVersion ||
      file.ledgerSchemaVersion !== identity.ledgerSchemaVersion ||
      file.backupFormatVersion !== identity.backupFormatVersion ||
      file.bodySlotBytes !== identity.bodySlotBytes ||
      file.bodySlotCount !== identity.bodySlotCount ||
      JSON.stringify(file.crypto) !== JSON.stringify(identity.crypto)
    ) {
      return invalid(
        "header",
        "Ledger file V3 S-2 header slots disagree on immutable metadata",
      );
    }
  }
  return { ok: true, value: { candidates, headerSlots } };
}

export function validateLedgerFileV3S2(
  input: unknown,
): LedgerFileV3S2ValidationResult {
  if (!isExactObject(input, LOGICAL_FILE_KEYS)) {
    return invalid(
      "file",
      "Ledger file must contain exactly the V3 S-2 logical fields",
    );
  }
  if (
    input.fileFormatVersion !== LEDGER_FILE_OUTER_V3_S2_CONSTANTS.fileFormatVersion ||
    input.cryptoVersion !== LEDGER_FILE_OUTER_V3_S2_CONSTANTS.cryptoVersion ||
    input.ledgerSchemaVersion !== LEDGER_FILE_OUTER_V3_S2_CONSTANTS.ledgerSchemaVersion ||
    input.backupFormatVersion !== LEDGER_FILE_OUTER_V3_S2_CONSTANTS.backupFormatVersion
  ) {
    return invalidVersion();
  }
  if (!isTechnicalId(input.fileId)) {
    return invalid("fileId", "Ledger file V3 S-2 fileId is invalid");
  }
  if (!isHeaderSlot(input.activeHeaderSlot)) {
    return invalid(
      "activeHeaderSlot",
      "Ledger file V3 S-2 active header slot is invalid",
    );
  }
  if (!Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1) {
    return invalid("sequence", "Ledger file V3 S-2 sequence is invalid");
  }
  if (!isValidBodySlotBytes(input.bodySlotBytes)) {
    return invalid(
      "bodySlotBytes",
      "Ledger file V3 S-2 body slot size is invalid",
    );
  }
  if (input.bodySlotCount !== LEDGER_FILE_BODY_SLOT_COUNT) {
    return invalid(
      "bodySlotCount",
      "Ledger file V3 S-2 must use exactly three body slots",
    );
  }
  const cryptoResult = validateCrypto(input.crypto, input.cryptoVersion);
  if (!cryptoResult.ok) return cryptoResult;
  const currentResult = validateGeneration(
    input.current,
    "current",
    input.bodySlotBytes as number,
  );
  if (!currentResult.ok) return currentResult;
  let previous: EncryptedLedgerGenerationV3S2 | null = null;
  if (input.previous !== null) {
    const previousResult = validateGeneration(
      input.previous,
      "previous",
      input.bodySlotBytes as number,
    );
    if (!previousResult.ok) return previousResult;
    previous = previousResult.value;
  }
  const current = currentResult.value;
  if (previous === null) {
    if (current.parentRevisionId !== null) {
      return failure(
        "LEDGER_FILE_INVALID_REVISION_CHAIN",
        "current.parentRevisionId",
        "The first V3 S-2 generation must not have a parent revision",
      );
    }
  } else if (
    current.revisionId === previous.revisionId ||
    current.parentRevisionId !== previous.revisionId ||
    current.ivBase64Url === previous.ivBase64Url ||
    current.bodySlot === previous.bodySlot
  ) {
    return failure(
      "LEDGER_FILE_INVALID_REVISION_CHAIN",
      "current",
      "Current and previous V3 S-2 generations are not adjacent independent slots",
    );
  }
  return { ok: true, value: input as LedgerFileV3S2 };
}

export function readLedgerFileBodySlotV3S2(
  bytes: Uint8Array,
  slot: LedgerFileBodySlotV3S2,
): Uint8Array {
  const outer = validateOuterLayout(bytes);
  if (!outer.ok) {
    throw new Error("Cannot read a body slot from an invalid V3 S-2 file", {
      cause: outer.errors,
    });
  }
  const start = ledgerFileBodySlotOffsetV3S2(
    outer.value.bodySlotBytes,
    slot,
  );
  return Uint8Array.from(
    bytes.subarray(start, start + outer.value.bodySlotBytes),
  );
}

export function readLedgerFileHeaderJsonV3S2(
  bytes: Uint8Array,
  slot: LedgerFileHeaderSlotV3S2,
): string {
  const offset = ledgerFileHeaderSlotOffsetV3S2(slot);
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(offset + HEADER_JSON_LENGTH_BYTES, offset + HEADER_JSON_LENGTH_BYTES + length),
  );
}

function validateOuterLayout(
  bytes: Uint8Array,
):
  | { ok: true; value: { bodySlotBytes: number } }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isLedgerFileV3S2Bytes(bytes) || bytes.byteLength < PREFIX_BYTES) {
    return invalid("file", "Ledger file does not use the V3 S-2 slot magic");
  }
  if (bytes.byteLength > LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumFileBytes) {
    return invalid("file", "Ledger file V3 S-2 exceeds its outer byte limit");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSlotBytes = view.getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  const bodySlotBytes = view.getUint32(
    LEDGER_FILE_V3_MAGIC.byteLength + Uint32Array.BYTES_PER_ELEMENT,
    true,
  );
  if (headerSlotBytes !== LEDGER_FILE_HEADER_SLOT_BYTES) {
    return invalid("headerSlotBytes", "Ledger file V3 S-2 header slot size is invalid");
  }
  if (!isValidBodySlotBytes(bodySlotBytes)) {
    return invalid("bodySlotBytes", "Ledger file V3 S-2 body slot size is invalid");
  }
  if (bytes.byteLength !== expectedFileByteLength(bodySlotBytes)) {
    return invalid("file", "Ledger file V3 S-2 length does not match its fixed slots");
  }
  return { ok: true, value: { bodySlotBytes } };
}

function parseHeaderSlot(
  bytes: Uint8Array,
  slot: LedgerFileHeaderSlotV3S2,
  bodySlotBytes: number,
): LedgerFileV3S2HeaderSlotState {
  const offset = ledgerFileHeaderSlotOffsetV3S2(slot);
  const slotBytes = bytes.subarray(offset, offset + LEDGER_FILE_HEADER_SLOT_BYTES);
  const length = new DataView(
    slotBytes.buffer,
    slotBytes.byteOffset,
    slotBytes.byteLength,
  ).getUint32(0, true);
  if (length === 0 && slotBytes.every((value) => value === 0)) {
    return { slot, status: "empty" };
  }
  if (
    length === 0 ||
    length > LEDGER_FILE_HEADER_SLOT_BYTES - HEADER_JSON_LENGTH_BYTES
  ) {
    return {
      slot,
      status: "invalid",
      errors: invalid("header", `Ledger file V3 S-2 header slot ${slot} length is invalid`).errors,
    };
  }
  if (
    !slotBytes
      .subarray(HEADER_JSON_LENGTH_BYTES + length)
      .every((value) => value === 0)
  ) {
    return {
      slot,
      status: "invalid",
      errors: invalid(
        "header",
        `Ledger file V3 S-2 header slot ${slot} padding is not zero`,
      ).errors,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        slotBytes.subarray(
          HEADER_JSON_LENGTH_BYTES,
          HEADER_JSON_LENGTH_BYTES + length,
        ),
      ),
    );
  } catch (error) {
    return {
      slot,
      status: "invalid",
      errors: invalid(
        "header",
        `Ledger file V3 S-2 header slot ${slot} is not valid UTF-8 JSON`,
        error,
      ).errors,
    };
  }
  const headerResult = validateHeader(parsed, bodySlotBytes);
  if (!headerResult.ok) {
    return { slot, status: "invalid", errors: headerResult.errors };
  }
  const header = headerResult.value;
  const currentRead = readGenerationFromSlot(bytes, header.current, bodySlotBytes);
  const previousRead = header.previous
    ? readGenerationFromSlot(bytes, header.previous, bodySlotBytes)
    : null;
  const file: LedgerFileV3S2 = {
    fileFormatVersion: header.fileFormatVersion,
    cryptoVersion: header.cryptoVersion,
    ledgerSchemaVersion: header.ledgerSchemaVersion,
    backupFormatVersion: header.backupFormatVersion,
    fileId: header.fileId,
    sequence: header.sequence,
    activeHeaderSlot: slot,
    bodySlotBytes: header.bodySlotBytes,
    bodySlotCount: header.bodySlotCount,
    crypto: header.crypto,
    current: currentRead.generation,
    previous: previousRead?.generation ?? null,
  };
  const validation = validateLedgerFileV3S2(file);
  if (!validation.ok) {
    return { slot, status: "invalid", errors: validation.errors };
  }
  return {
    slot,
    status: "candidate",
    candidate: {
      file,
      currentPaddingIsZero: currentRead.paddingIsZero,
      previousPaddingIsZero: previousRead?.paddingIsZero ?? true,
    },
  };
}

function validateHeader(
  input: unknown,
  outerBodySlotBytes: number,
):
  | { ok: true; value: LedgerFileHeaderV3S2 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, HEADER_KEYS)) {
    return invalid("header", "Ledger file V3 S-2 header fields are invalid");
  }
  if (
    input.fileFormatVersion !== 3 ||
    input.cryptoVersion !== 1 ||
    input.ledgerSchemaVersion !== 5 ||
    input.backupFormatVersion !== 3
  ) {
    return invalidVersion();
  }
  if (
    input.bodySlotBytes !== outerBodySlotBytes ||
    input.bodySlotCount !== LEDGER_FILE_BODY_SLOT_COUNT ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) < 1 ||
    !isTechnicalId(input.fileId)
  ) {
    return invalid("header", "Ledger file V3 S-2 header metadata is invalid");
  }
  const cryptoResult = validateCrypto(input.crypto, input.cryptoVersion);
  if (!cryptoResult.ok) return cryptoResult;
  const current = validateGenerationHeader(input.current, "current", outerBodySlotBytes);
  if (!current.ok) return current;
  let previous: LedgerFileGenerationHeaderV3S2 | null = null;
  if (input.previous !== null) {
    const result = validateGenerationHeader(input.previous, "previous", outerBodySlotBytes);
    if (!result.ok) return result;
    previous = result.value;
  }
  return {
    ok: true,
    value: {
      fileFormatVersion: 3,
      cryptoVersion: 1,
      ledgerSchemaVersion: 5,
      backupFormatVersion: 3,
      fileId: input.fileId as string,
      sequence: input.sequence as number,
      bodySlotBytes: outerBodySlotBytes,
      bodySlotCount: LEDGER_FILE_BODY_SLOT_COUNT,
      crypto: input.crypto as LedgerFileCryptoV2,
      current: current.value,
      previous,
    },
  };
}

function validateGeneration(
  input: unknown,
  path: "current" | "previous",
  bodySlotBytes: number,
):
  | { ok: true; value: EncryptedLedgerGenerationV3S2 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, GENERATION_KEYS)) {
    return invalid(path, `${path} V3 S-2 generation fields are invalid`);
  }
  if (
    input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION ||
    !isTechnicalId(input.revisionId) ||
    !(input.parentRevisionId === null || isTechnicalId(input.parentRevisionId)) ||
    !isBodySlot(input.bodySlot) ||
    typeof input.ivBase64Url !== "string" ||
    !(input.ciphertextBytes instanceof Uint8Array) ||
    input.ciphertextBytes.byteLength < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
    input.ciphertextBytes.byteLength > bodySlotBytes
  ) {
    return invalid(path, `${path} contains invalid V3 S-2 generation metadata`);
  }
  try {
    if (
      base64UrlToBytes(input.ivBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes
    ) {
      return invalid(path, `${path} V3 S-2 IV length is invalid`);
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      `${path}.ivBase64Url`,
      `${path} V3 S-2 IV is not canonical Base64URL`,
      error,
    );
  }
  return { ok: true, value: input as EncryptedLedgerGenerationV3S2 };
}

function validateGenerationHeader(
  input: unknown,
  path: "current" | "previous",
  bodySlotBytes: number,
):
  | { ok: true; value: LedgerFileGenerationHeaderV3S2 }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (
    !isExactObject(input, GENERATION_HEADER_KEYS) ||
    !Number.isSafeInteger(input.ciphertextByteLength) ||
    (input.ciphertextByteLength as number) < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
    (input.ciphertextByteLength as number) > bodySlotBytes ||
    !isBodySlot(input.bodySlot) ||
    !isTechnicalId(input.revisionId) ||
    !(input.parentRevisionId === null || isTechnicalId(input.parentRevisionId)) ||
    input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION ||
    typeof input.ivBase64Url !== "string"
  ) {
    return invalid(path, `${path} V3 S-2 generation header is invalid`);
  }
  try {
    if (
      base64UrlToBytes(input.ivBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes
    ) {
      return invalid(path, `${path} V3 S-2 IV length is invalid`);
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      `${path}.ivBase64Url`,
      `${path} V3 S-2 IV is not canonical Base64URL`,
      error,
    );
  }
  return { ok: true, value: input as LedgerFileGenerationHeaderV3S2 };
}

function validateCrypto(
  input: unknown,
  cryptoVersion: unknown,
):
  | { ok: true }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, CRYPTO_KEYS)) {
    return invalid("crypto", "Ledger file V3 S-2 crypto metadata is invalid");
  }
  if (!isExactObject(input.kdf, KDF_KEYS) || !isExactObject(input.cipher, CIPHER_KEYS)) {
    return invalid("crypto", "Ledger file V3 S-2 crypto metadata is invalid");
  }
  if (
    input.cryptoVersion !== cryptoVersion ||
    input.kdf.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName ||
    input.kdf.hash !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash ||
    input.kdf.iterations !== LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations ||
    input.cipher.name !== LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName ||
    input.cipher.keyLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength ||
    input.cipher.tagLength !== LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength ||
    typeof input.kdf.saltBase64Url !== "string"
  ) {
    return failure(
      "LEDGER_FILE_INVALID_CRYPTO_PARAMETERS",
      "crypto",
      "Ledger file V3 S-2 crypto parameters are unsupported",
    );
  }
  try {
    if (
      base64UrlToBytes(input.kdf.saltBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.saltBytes
    ) {
      return failure(
        "LEDGER_FILE_INVALID_ENCODING",
        "crypto.kdf.saltBase64Url",
        "Ledger file V3 S-2 salt must decode to 16 bytes",
      );
    }
  } catch (error) {
    return failure(
      "LEDGER_FILE_INVALID_ENCODING",
      "crypto.kdf.saltBase64Url",
      "Ledger file V3 S-2 salt is not canonical Base64URL",
      error,
    );
  }
  return { ok: true };
}

function readGenerationFromSlot(
  bytes: Uint8Array,
  header: LedgerFileGenerationHeaderV3S2,
  bodySlotBytes: number,
): { generation: EncryptedLedgerGenerationV3S2; paddingIsZero: boolean } {
  const start = ledgerFileBodySlotOffsetV3S2(bodySlotBytes, header.bodySlot);
  const ciphertextEnd = start + header.ciphertextByteLength;
  const slotEnd = start + bodySlotBytes;
  return {
    generation: {
      revisionId: header.revisionId,
      parentRevisionId: header.parentRevisionId,
      ledgerSchemaVersion: header.ledgerSchemaVersion,
      bodySlot: header.bodySlot,
      ivBase64Url: header.ivBase64Url,
      ciphertextBytes: Uint8Array.from(bytes.subarray(start, ciphertextEnd)),
    },
    paddingIsZero: bytes.subarray(ciphertextEnd, slotEnd).every((value) => value === 0),
  };
}
