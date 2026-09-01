import { base64UrlToBytes } from "@/platform/encryption";
import { byteArraysEqual } from "./byteArraysEqual";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  MAX_LEDGER_FILE_V2_BYTES,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";

export const RECORDS_PER_LEDGER_BLOCK = 2_000;
export const LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES = 256 * 1024;
export const LEDGER_FILE_V3_S3_BODY_SLOT_BYTES = 1024 * 1024;
export const LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES = 16;

const PREFIX_UINT32_FIELDS = 2;
const PREFIX_BYTES =
  LEDGER_FILE_V3_MAGIC.byteLength +
  Uint32Array.BYTES_PER_ELEMENT * PREFIX_UINT32_FIELDS;
const HEADER_JSON_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;

export const LEDGER_FILE_OUTER_V3_S3_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 4,
  backupFormatVersion: 3,
  headerSlotBytes: LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

export type LedgerFileHeaderSlotV3S3 = 0 | 1;
export type LedgerFileBlockRoleV3S3 = "control" | "facts";

export type EncryptedLedgerBlockV3S3 = {
  blockId: string;
  role: LedgerFileBlockRoleV3S3;
  order: number;
  sealed: boolean;
  recordCount: number;
  ledgerSchemaVersion: 4;
  ivBase64Url: string;
  plaintextByteLength: number;
  bodySlots: number[];
  ciphertextBytes: Uint8Array;
};

export type LedgerGenerationV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: EncryptedLedgerBlockV3S3;
  factBlocks: EncryptedLedgerBlockV3S3[];
  openBlockId: string | null;
};

export type LedgerFileV3S3 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 4;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  activeHeaderSlot: LedgerFileHeaderSlotV3S3;
  recordsPerBlock: number;
  bodySlotBytes: number;
  bodySlotCount: number;
  crypto: LedgerFileCryptoV2;
  manifestAuthIvBase64Url: string;
  manifestAuthTagBytes: Uint8Array;
  current: LedgerGenerationV3S3;
  previous: LedgerGenerationV3S3 | null;
};

type LedgerBlockHeaderV3S3 = Omit<
  EncryptedLedgerBlockV3S3,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

type LedgerGenerationHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  factBlocks: LedgerBlockHeaderV3S3[];
  openBlockId: string | null;
};

type LedgerPreviousHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  changedFactBlocks: LedgerBlockHeaderV3S3[];
  currentOnlyBlockIds: string[];
};

type LedgerFileHeaderV3S3 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 4;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  recordsPerBlock: number;
  bodySlotBytes: number;
  bodySlotCount: number;
  crypto: LedgerFileCryptoV2;
  manifestAuthIvBase64Url: string;
  current: LedgerGenerationHeaderV3S3;
  previous: LedgerPreviousHeaderV3S3 | null;
};

export type LedgerFileV3S3ValidationResult =
  | { ok: true; value: LedgerFileV3S3 }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileV3S3HeaderCandidate = {
  file: LedgerFileV3S3;
  headerSlot: LedgerFileHeaderSlotV3S3;
  referencedPaddingIsZero: boolean;
};

export type LedgerFileV3S3CandidatesResult =
  | {
      ok: true;
      value: {
        candidates: LedgerFileV3S3HeaderCandidate[];
        reachableBodySlots: number[];
      };
    }
  | { ok: false; errors: LedgerFileContractError[] };

export type LedgerFileBinaryPatchV3S3 = {
  position: number;
  data: Uint8Array;
};

export type PreparedLedgerFileV3S3Write = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  mode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
};

const HEADER_KEYS = [
  "backupFormatVersion",
  "bodySlotBytes",
  "bodySlotCount",
  "crypto",
  "cryptoVersion",
  "current",
  "fileFormatVersion",
  "fileId",
  "ledgerSchemaVersion",
  "manifestAuthIvBase64Url",
  "previous",
  "recordsPerBlock",
  "sequence",
] as const;
const GENERATION_KEYS = [
  "controlBlock",
  "factBlocks",
  "openBlockId",
  "parentRevisionId",
  "revisionId",
] as const;
const PREVIOUS_KEYS = [
  "changedFactBlocks",
  "controlBlock",
  "currentOnlyBlockIds",
  "parentRevisionId",
  "revisionId",
] as const;
const BLOCK_HEADER_KEYS = [
  "blockId",
  "bodySlots",
  "ciphertextByteLength",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "order",
  "plaintextByteLength",
  "recordCount",
  "role",
  "sealed",
] as const;
const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
const KDF_KEYS = ["hash", "iterations", "name", "saltBase64Url"] as const;
const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;

export function isLedgerFileV3S3Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export function otherLedgerFileHeaderSlotV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): LedgerFileHeaderSlotV3S3 {
  return slot === 0 ? 1 : 0;
}

export function ledgerFileHeaderSlotOffsetV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): number {
  return PREFIX_BYTES + slot * LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES;
}

export function ledgerFileBodySlotOffsetV3S3(slot: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    slot * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

export function ledgerFileBodySlotsRequiredV3S3(
  ciphertextByteLength: number,
): number {
  if (
    !Number.isSafeInteger(ciphertextByteLength) ||
    ciphertextByteLength < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes
  ) {
    throw new Error("V3 S-3 ciphertext length is invalid");
  }
  return Math.ceil(
    ciphertextByteLength / LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  );
}

export function serializeLedgerFileV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  const validation = validateLedgerFileV3S3(file);
  if (!validation.ok) {
    throw new Error("Generated ledger file failed its V3 S-3 contract", {
      cause: validation.errors,
    });
  }
  const byteLength = expectedFileByteLength(file.bodySlotCount);
  const bytes = new Uint8Array(byteLength);
  writePrefix(bytes);
  bytes.set(
    encodeHeaderSlot(file),
    ledgerFileHeaderSlotOffsetV3S3(file.activeHeaderSlot),
  );
  for (const block of uniqueReachableBlocks(file)) {
    writeBlock(bytes, block);
  }
  return bytes;
}

export function prepareLedgerFileUpdateV3S3(
  baseFile: LedgerFileV3S3,
  baseSerializedFile: Uint8Array,
  nextFile: LedgerFileV3S3,
): PreparedLedgerFileV3S3Write {
  const baseValidation = validateLedgerFileV3S3(baseFile);
  const nextValidation = validateLedgerFileV3S3(nextFile);
  if (!baseValidation.ok || !nextValidation.ok) {
    throw new Error("V3 S-3 update requires valid base and candidate files", {
      cause: !baseValidation.ok ? baseValidation.errors : nextValidation.ok ? [] : nextValidation.errors,
    });
  }
  if (
    nextFile.fileId !== baseFile.fileId ||
    nextFile.sequence !== baseFile.sequence + 1 ||
    nextFile.activeHeaderSlot !==
      otherLedgerFileHeaderSlotV3S3(baseFile.activeHeaderSlot) ||
    nextFile.current.parentRevisionId !== nextFile.previous?.revisionId ||
    !(
      nextFile.previous.revisionId === baseFile.current.revisionId ||
      nextFile.previous.revisionId === baseFile.previous?.revisionId
    )
  ) {
    throw new Error("V3 S-3 update does not extend the verified base");
  }

  if (
    nextFile.bodySlotCount !== baseFile.bodySlotCount ||
    baseSerializedFile.byteLength !== expectedFileByteLength(baseFile.bodySlotCount)
  ) {
    return {
      file: nextFile,
      serializedFile: serializeLedgerFileV3S3(nextFile),
      mode: "replace",
      patches: [],
    };
  }

  const baseBlocks = new Map(
    uniqueReachableBlocks(baseFile).map((block) => [block.blockId, block]),
  );
  const changedBlocks = uniqueReachableBlocks(nextFile).filter((block) => {
    const base = baseBlocks.get(block.blockId);
    return !base || !sameBlock(base, block);
  });
  const bodyPatches = mergeContiguousPatches(
    changedBlocks.flatMap(blockPatches),
  );
  const headerPatch: LedgerFileBinaryPatchV3S3 = {
    position: ledgerFileHeaderSlotOffsetV3S3(nextFile.activeHeaderSlot),
    data: encodeHeaderSlot(nextFile),
  };
  const serializedFile = Uint8Array.from(baseSerializedFile);
  for (const patch of bodyPatches) {
    serializedFile.set(patch.data, patch.position);
  }
  serializedFile.set(headerPatch.data, headerPatch.position);
  return {
    file: nextFile,
    serializedFile,
    mode: "patch",
    patches: [...bodyPatches, headerPatch],
  };
}

export function parseLedgerFileV3S3(
  bytes: Uint8Array,
): LedgerFileV3S3ValidationResult {
  const parsed = parseLedgerFileV3S3Candidates(bytes);
  if (!parsed.ok) return parsed;
  const candidates = parsed.value.candidates
    .filter(({ referencedPaddingIsZero }) => referencedPaddingIsZero)
    .sort((left, right) => right.file.sequence - left.file.sequence);
  const selected = candidates[0];
  if (!selected) {
    return invalid("header", "Ledger file V3 S-3 has no complete header candidate");
  }
  if (
    candidates[1] &&
    candidates[1].file.sequence === selected.file.sequence
  ) {
    return invalid(
      "header.sequence",
      "Ledger file V3 S-3 header sequences must be unique",
    );
  }
  return { ok: true, value: selected.file };
}

export function parseLedgerFileV3S3Candidates(
  bytes: Uint8Array,
): LedgerFileV3S3CandidatesResult {
  const outer = validateOuterLayout(bytes);
  if (!outer.ok) return outer;
  const candidates: LedgerFileV3S3HeaderCandidate[] = [];
  const errors: LedgerFileContractError[] = [];
  for (const slot of [0, 1] as const) {
    const parsed = parseHeaderSlot(bytes, slot, outer.value.bodySlotCount);
    if (parsed.status === "candidate") {
      candidates.push(parsed.candidate);
    } else if (parsed.status === "invalid") {
      errors.push(...parsed.errors);
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      errors: errors.length > 0
        ? errors
        : [contractError("header", "Both V3 S-3 header slots are empty")],
    };
  }
  const reachableBodySlots = Array.from(
    new Set(
      candidates.flatMap(({ file }) =>
        uniqueReachableBlocks(file).flatMap(({ bodySlots }) => bodySlots),
      ),
    ),
  ).sort((left, right) => left - right);
  return { ok: true, value: { candidates, reachableBodySlots } };
}

export function validateLedgerFileV3S3(
  input: unknown,
): LedgerFileV3S3ValidationResult {
  if (!isLogicalFile(input)) {
    return invalid("file", "Ledger file must use the exact V3 S-3 logical shape");
  }
  if (
    input.fileFormatVersion !== 3 ||
    input.cryptoVersion !== 1 ||
    input.ledgerSchemaVersion !== 4 ||
    input.backupFormatVersion !== 3
  ) {
    return invalid("fileFormatVersion", "Unsupported V3 S-3 version tuple");
  }
  if (!isTechnicalId(input.fileId)) {
    return invalid("fileId", "fileId must be a bounded technical identifier");
  }
  if (
    typeof input.sequence !== "number" ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) < 1 ||
    (input.activeHeaderSlot !== 0 && input.activeHeaderSlot !== 1) ||
    input.recordsPerBlock !== RECORDS_PER_LEDGER_BLOCK ||
    input.bodySlotBytes !== LEDGER_FILE_V3_S3_BODY_SLOT_BYTES ||
    !Number.isSafeInteger(input.bodySlotCount) ||
    input.bodySlotCount < 1 ||
    expectedFileByteLength(input.bodySlotCount) >
      LEDGER_FILE_OUTER_V3_S3_CONSTANTS.maximumFileBytes
  ) {
    return invalid("layout", "V3 S-3 sequence or fixed slot layout is invalid");
  }
  const cryptoError = validateCrypto(input.crypto);
  if (cryptoError) return { ok: false, errors: [cryptoError] };
  try {
    if (
      base64UrlToBytes(input.manifestAuthIvBase64Url).byteLength !==
        LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes ||
      input.manifestAuthTagBytes.byteLength !==
        LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES
    ) {
      return invalid("manifest", "Manifest IV or tag length is invalid");
    }
  } catch (error) {
    return invalid("manifestAuthIvBase64Url", "Manifest IV is not canonical Base64URL", error);
  }

  const currentError = validateGeneration(input.current, "current", input.bodySlotCount);
  if (currentError) return { ok: false, errors: [currentError] };
  if (input.previous === null) {
    if (input.current.parentRevisionId !== null) {
      return invalid("current.parentRevisionId", "The first chunked generation must not have a parent");
    }
  } else {
    const previousError = validateGeneration(input.previous, "previous", input.bodySlotCount);
    if (previousError) return { ok: false, errors: [previousError] };
    if (
      input.current.revisionId === input.previous.revisionId ||
      input.current.parentRevisionId !== input.previous.revisionId
    ) {
      return invalid("current", "Current and previous chunked revisions are not adjacent");
    }
    const crossError = validateCrossGenerationSlots(input.current, input.previous);
    if (crossError) return { ok: false, errors: [crossError] };
  }
  const ivError = validateLogicalFileIvUniqueness(input);
  if (ivError) return { ok: false, errors: [ivError] };
  return { ok: true, value: input };
}

export function createLedgerFileBlockAadV3S3(
  file: Pick<
    LedgerFileV3S3,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  block: Omit<EncryptedLedgerBlockV3S3, "ciphertextBytes">,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: orderedCrypto(file.crypto),
    block: orderedBlockMetadata(block),
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function createLedgerFileManifestAadV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(toHeader(file)));
}

function parseHeaderSlot(
  bytes: Uint8Array,
  slot: LedgerFileHeaderSlotV3S3,
  outerBodySlotCount: number,
):
  | { status: "empty" }
  | { status: "invalid"; errors: LedgerFileContractError[] }
  | { status: "candidate"; candidate: LedgerFileV3S3HeaderCandidate } {
  const offset = ledgerFileHeaderSlotOffsetV3S3(slot);
  const slotBytes = bytes.subarray(
    offset,
    offset + LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  );
  if (slotBytes.every((byte) => byte === 0)) return { status: "empty" };
  const length = new DataView(
    slotBytes.buffer,
    slotBytes.byteOffset,
    slotBytes.byteLength,
  ).getUint32(0, true);
  const maximumJsonBytes =
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES -
    HEADER_JSON_LENGTH_BYTES -
    LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES;
  if (length < 2 || length > maximumJsonBytes) {
    return { status: "invalid", errors: [contractError(`header[${slot}]`, "Header JSON length is invalid")] };
  }
  let input: unknown;
  try {
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        slotBytes.subarray(HEADER_JSON_LENGTH_BYTES, HEADER_JSON_LENGTH_BYTES + length),
      ),
    );
  } catch (error) {
    return { status: "invalid", errors: [contractError(`header[${slot}]`, "Header JSON is not valid UTF-8 JSON", error)] };
  }
  const headerResult = validateHeader(input, outerBodySlotCount);
  if (!headerResult.ok) return { status: "invalid", errors: headerResult.errors };
  try {
    const current = readGeneration(bytes, headerResult.value.current);
    const previous = headerResult.value.previous
      ? reconstructPreviousGeneration(
          current,
          headerResult.value.previous,
          bytes,
        )
      : null;
    const manifestAuthTagBytes = Uint8Array.from(
      slotBytes.subarray(
        LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES - LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
      ),
    );
    const file: LedgerFileV3S3 = {
      ...headerResult.value,
      activeHeaderSlot: slot,
      manifestAuthTagBytes,
      current,
      previous,
    };
    const validation = validateLedgerFileV3S3(file);
    if (!validation.ok) return { status: "invalid", errors: validation.errors };
    const paddingStart = HEADER_JSON_LENGTH_BYTES + length;
    const paddingEnd =
      LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES - LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES;
    const headerPaddingIsZero = slotBytes
      .subarray(paddingStart, paddingEnd)
      .every((byte) => byte === 0);
    const referencedPaddingIsZero =
      headerPaddingIsZero &&
      uniqueReachableBlocks(file).every((block) => blockPaddingIsZero(bytes, block));
    return {
      status: "candidate",
      candidate: { file, headerSlot: slot, referencedPaddingIsZero },
    };
  } catch (error) {
    return { status: "invalid", errors: [contractError(`header[${slot}]`, "Header references invalid body slots", error)] };
  }
}

function validateOuterLayout(bytes: Uint8Array):
  | { ok: true; value: { bodySlotCount: number } }
  | { ok: false; errors: LedgerFileContractError[] } {
  if (!isLedgerFileV3S3Bytes(bytes) || bytes.byteLength < PREFIX_BYTES) {
    return invalid("magic", "Ledger file does not use the V3 binary magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSlotBytes = view.getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  const bodySlotBytes = view.getUint32(LEDGER_FILE_V3_MAGIC.byteLength + 4, true);
  if (
    headerSlotBytes !== LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES ||
    bodySlotBytes !== LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  ) {
    return invalid("layout", "Ledger file does not use the fixed V3 S-3 slot sizes");
  }
  const bodyBytes =
    bytes.byteLength - PREFIX_BYTES - LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2;
  if (
    bodyBytes < LEDGER_FILE_V3_S3_BODY_SLOT_BYTES ||
    bodyBytes % LEDGER_FILE_V3_S3_BODY_SLOT_BYTES !== 0 ||
    bytes.byteLength > LEDGER_FILE_OUTER_V3_S3_CONSTANTS.maximumFileBytes
  ) {
    return invalid("layout", "Ledger file byte length does not match complete body slots");
  }
  return { ok: true, value: { bodySlotCount: bodyBytes / LEDGER_FILE_V3_S3_BODY_SLOT_BYTES } };
}

function validateHeader(
  input: unknown,
  outerBodySlotCount: number,
): { ok: true; value: LedgerFileHeaderV3S3 } | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, HEADER_KEYS)) {
    return invalid("header", "Header must contain exactly the V3 S-3 fields");
  }
  if (
    input.fileFormatVersion !== 3 ||
    input.cryptoVersion !== 1 ||
    input.ledgerSchemaVersion !== 4 ||
    input.backupFormatVersion !== 3 ||
    !isTechnicalId(input.fileId) ||
    typeof input.sequence !== "number" ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) < 1 ||
    input.recordsPerBlock !== RECORDS_PER_LEDGER_BLOCK ||
    input.bodySlotBytes !== LEDGER_FILE_V3_S3_BODY_SLOT_BYTES ||
    input.bodySlotCount !== outerBodySlotCount ||
    typeof input.manifestAuthIvBase64Url !== "string"
  ) {
    return invalid("header", "Header versions, identity, sequence, or layout is invalid");
  }
  const cryptoError = validateCrypto(input.crypto);
  if (cryptoError) return { ok: false, errors: [cryptoError] };
  try {
    if (
      base64UrlToBytes(input.manifestAuthIvBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes
    ) {
      return invalid("manifestAuthIvBase64Url", "Manifest IV must be 12 bytes");
    }
  } catch (error) {
    return invalid("manifestAuthIvBase64Url", "Manifest IV is not canonical Base64URL", error);
  }
  const current = validateGenerationHeader(input.current, "current", outerBodySlotCount);
  if (!current.ok) return current;
  let previous: LedgerPreviousHeaderV3S3 | null = null;
  if (input.previous !== null) {
    const result = validatePreviousHeader(input.previous, outerBodySlotCount);
    if (!result.ok) return result;
    previous = result.value;
  }
  return {
    ok: true,
    value: {
      fileFormatVersion: 3,
      cryptoVersion: 1,
      ledgerSchemaVersion: 4,
      backupFormatVersion: 3,
      fileId: input.fileId,
      sequence: input.sequence as number,
      recordsPerBlock: RECORDS_PER_LEDGER_BLOCK,
      bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
      bodySlotCount: outerBodySlotCount,
      crypto: input.crypto as LedgerFileCryptoV2,
      manifestAuthIvBase64Url: input.manifestAuthIvBase64Url,
      current: current.value,
      previous,
    },
  };
}

function validateGenerationHeader(
  input: unknown,
  path: string,
  bodySlotCount: number,
): { ok: true; value: LedgerGenerationHeaderV3S3 } | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, GENERATION_KEYS)) {
    return invalid(path, `${path} must use the exact chunked generation shape`);
  }
  if (
    !isTechnicalId(input.revisionId) ||
    !(input.parentRevisionId === null || isTechnicalId(input.parentRevisionId)) ||
    !(input.openBlockId === null || isTechnicalId(input.openBlockId)) ||
    !Array.isArray(input.factBlocks)
  ) {
    return invalid(path, `${path} revision or block list is invalid`);
  }
  const control = validateBlockHeader(input.controlBlock, `${path}.controlBlock`, bodySlotCount, "control");
  if (!control.ok) return control;
  const facts: LedgerBlockHeaderV3S3[] = [];
  for (let index = 0; index < input.factBlocks.length; index += 1) {
    const result = validateBlockHeader(input.factBlocks[index], `${path}.factBlocks[${index}]`, bodySlotCount, "facts");
    if (!result.ok) return result;
    facts.push(result.value);
  }
  const orderError = validateFactBlockOrder(facts, input.openBlockId, path);
  if (orderError) return { ok: false, errors: [orderError] };
  return { ok: true, value: {
    revisionId: input.revisionId,
    parentRevisionId: input.parentRevisionId,
    controlBlock: control.value,
    factBlocks: facts,
    openBlockId: input.openBlockId,
  } };
}

function validatePreviousHeader(
  input: unknown,
  bodySlotCount: number,
): { ok: true; value: LedgerPreviousHeaderV3S3 } | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, PREVIOUS_KEYS)) {
    return invalid("previous", "previous must use the exact V3 S-3 delta shape");
  }
  if (
    !isTechnicalId(input.revisionId) ||
    !(input.parentRevisionId === null || isTechnicalId(input.parentRevisionId)) ||
    !Array.isArray(input.changedFactBlocks) ||
    !Array.isArray(input.currentOnlyBlockIds) ||
    !input.currentOnlyBlockIds.every(isTechnicalId)
  ) {
    return invalid("previous", "previous revision or delta lists are invalid");
  }
  const control = validateBlockHeader(input.controlBlock, "previous.controlBlock", bodySlotCount, "control");
  if (!control.ok) return control;
  const changed: LedgerBlockHeaderV3S3[] = [];
  for (let index = 0; index < input.changedFactBlocks.length; index += 1) {
    const result = validateBlockHeader(input.changedFactBlocks[index], `previous.changedFactBlocks[${index}]`, bodySlotCount, "facts");
    if (!result.ok) return result;
    changed.push(result.value);
  }
  if (new Set(input.currentOnlyBlockIds).size !== input.currentOnlyBlockIds.length) {
    return invalid("previous.currentOnlyBlockIds", "currentOnlyBlockIds must be unique");
  }
  return { ok: true, value: {
    revisionId: input.revisionId,
    parentRevisionId: input.parentRevisionId,
    controlBlock: control.value,
    changedFactBlocks: changed,
    currentOnlyBlockIds: [...input.currentOnlyBlockIds],
  } };
}

function validateBlockHeader(
  input: unknown,
  path: string,
  bodySlotCount: number,
  role: LedgerFileBlockRoleV3S3,
): { ok: true; value: LedgerBlockHeaderV3S3 } | { ok: false; errors: LedgerFileContractError[] } {
  if (!isExactObject(input, BLOCK_HEADER_KEYS)) {
    return invalid(path, `${path} must use the exact V3 S-3 block shape`);
  }
  if (
    !isTechnicalId(input.blockId) ||
    input.role !== role ||
    typeof input.order !== "number" ||
    !Number.isSafeInteger(input.order) ||
    input.order < 0 ||
    typeof input.sealed !== "boolean" ||
    typeof input.recordCount !== "number" ||
    !Number.isSafeInteger(input.recordCount) ||
    input.recordCount < 0 ||
    input.recordCount > RECORDS_PER_LEDGER_BLOCK ||
    input.ledgerSchemaVersion !== SUPPORTED_LEDGER_SCHEMA_VERSION ||
    typeof input.ivBase64Url !== "string" ||
    typeof input.plaintextByteLength !== "number" ||
    !Number.isSafeInteger(input.plaintextByteLength) ||
    input.plaintextByteLength < 0 ||
    typeof input.ciphertextByteLength !== "number" ||
    !Number.isSafeInteger(input.ciphertextByteLength) ||
    input.ciphertextByteLength !== input.plaintextByteLength + 16 ||
    !Array.isArray(input.bodySlots) ||
    input.bodySlots.length !== ledgerFileBodySlotsRequiredV3S3(input.ciphertextByteLength) ||
    !input.bodySlots.every(
      (slot: unknown) => Number.isSafeInteger(slot) && (slot as number) >= 0 && (slot as number) < bodySlotCount,
    ) ||
    new Set(input.bodySlots).size !== input.bodySlots.length
  ) {
    return invalid(path, `${path} metadata or body slots are invalid`);
  }
  if (
    role === "control" &&
    (input.order !== 0 || !input.sealed || input.recordCount !== 0)
  ) {
    return invalid(path, "Control block metadata is invalid");
  }
  if (role === "facts" && input.recordCount === 0) {
    return invalid(path, "Empty fact blocks are not allowed");
  }
  try {
    if (
      base64UrlToBytes(input.ivBase64Url).byteLength !==
      LEDGER_FILE_OUTER_V2_CONSTANTS.ivBytes
    ) {
      return invalid(`${path}.ivBase64Url`, "Block IV must be 12 bytes");
    }
  } catch (error) {
    return invalid(`${path}.ivBase64Url`, "Block IV is not canonical Base64URL", error);
  }
  return { ok: true, value: input as LedgerBlockHeaderV3S3 };
}

function validateGeneration(
  generation: LedgerGenerationV3S3,
  path: string,
  bodySlotCount: number,
): LedgerFileContractError | null {
  const headerResult = validateGenerationHeader(
    generationHeader(generation),
    path,
    bodySlotCount,
  );
  if (!headerResult.ok) return headerResult.errors[0]!;
  const blocks = [generation.controlBlock, ...generation.factBlocks];
  for (const block of blocks) {
    if (
      block.ciphertextBytes.byteLength !== block.plaintextByteLength + 16 ||
      block.ciphertextBytes.byteLength > block.bodySlots.length * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
    ) {
      return contractError(`${path}.${block.blockId}`, "Block ciphertext length is invalid");
    }
  }
  const slots = blocks.flatMap(({ bodySlots }) => bodySlots);
  if (new Set(slots).size !== slots.length) {
    return contractError(path, "Blocks within one generation must not overlap body slots");
  }
  return null;
}

function validateCrossGenerationSlots(
  current: LedgerGenerationV3S3,
  previous: LedgerGenerationV3S3,
): LedgerFileContractError | null {
  const currentBySlot = blocksBySlot(current);
  const previousBySlot = blocksBySlot(previous);
  for (const [slot, currentBlock] of currentBySlot) {
    const previousBlock = previousBySlot.get(slot);
    if (previousBlock && !sameBlock(currentBlock, previousBlock)) {
      return contractError("previous", "Current and previous may share only the exact same authenticated block");
    }
  }
  return null;
}

function validateLogicalFileIvUniqueness(
  file: LedgerFileV3S3,
): LedgerFileContractError | null {
  const byIv = new Map<string, EncryptedLedgerBlockV3S3>();
  for (const block of uniqueReachableBlocks(file)) {
    if (block.ivBase64Url === file.manifestAuthIvBase64Url) {
      return contractError(
        "manifestAuthIvBase64Url",
        "Manifest and block authentication objects must not reuse an IV",
      );
    }
    const existing = byIv.get(block.ivBase64Url);
    if (existing && !sameBlock(existing, block)) {
      return contractError(
        "current",
        "Independent encrypted blocks must not reuse an IV",
      );
    }
    byIv.set(block.ivBase64Url, block);
  }
  return null;
}

function validateFactBlockOrder(
  blocks: LedgerBlockHeaderV3S3[],
  openBlockId: unknown,
  path: string,
): LedgerFileContractError | null {
  const ids = new Set<string>();
  let openCount = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (
      ids.has(block.blockId) ||
      (index > 0 && block.order <= blocks[index - 1]!.order)
    ) {
      return contractError(`${path}.factBlocks`, "Fact block ids must be unique and orders must increase");
    }
    ids.add(block.blockId);
    if (!block.sealed) {
      openCount += 1;
      if (block.recordCount >= RECORDS_PER_LEDGER_BLOCK || openBlockId !== block.blockId) {
        return contractError(`${path}.openBlockId`, "The open fact block marker is inconsistent");
      }
    } else if (block.recordCount > RECORDS_PER_LEDGER_BLOCK) {
      return contractError(`${path}.factBlocks[${index}]`, "A sealed fact block exceeds the record limit");
    }
  }
  if (
    openCount > 1 ||
    (openCount === 0 && openBlockId !== null) ||
    (openBlockId !== null && !ids.has(openBlockId as string))
  ) {
    return contractError(`${path}.openBlockId`, "Generation must have at most one declared open block");
  }
  return null;
}

function readGeneration(
  bytes: Uint8Array,
  header: LedgerGenerationHeaderV3S3,
): LedgerGenerationV3S3 {
  return {
    revisionId: header.revisionId,
    parentRevisionId: header.parentRevisionId,
    controlBlock: readBlock(bytes, header.controlBlock),
    factBlocks: header.factBlocks.map((block) => readBlock(bytes, block)),
    openBlockId: header.openBlockId,
  };
}

function reconstructPreviousGeneration(
  current: LedgerGenerationV3S3,
  previous: LedgerPreviousHeaderV3S3,
  bytes: Uint8Array,
): LedgerGenerationV3S3 {
  const currentOnly = new Set(previous.currentOnlyBlockIds);
  const blocks = new Map(
    current.factBlocks
      .filter(({ blockId }) => !currentOnly.has(blockId))
      .map((block) => [block.blockId, block]),
  );
  for (const header of previous.changedFactBlocks) {
    blocks.set(header.blockId, readBlock(bytes, header));
  }
  const factBlocks = Array.from(blocks.values()).sort(
    (left, right) => left.order - right.order,
  );
  const open = factBlocks.filter(({ sealed }) => !sealed);
  return {
    revisionId: previous.revisionId,
    parentRevisionId: previous.parentRevisionId,
    controlBlock: readBlock(bytes, previous.controlBlock),
    factBlocks,
    openBlockId: open.length === 1 ? open[0]!.blockId : null,
  };
}

function readBlock(bytes: Uint8Array, header: LedgerBlockHeaderV3S3): EncryptedLedgerBlockV3S3 {
  const { ciphertextByteLength, ...metadata } = header;
  const ciphertextBytes = new Uint8Array(ciphertextByteLength);
  let copied = 0;
  for (const slot of header.bodySlots) {
    const offset = ledgerFileBodySlotOffsetV3S3(slot);
    const take = Math.min(
      LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
      ciphertextByteLength - copied,
    );
    ciphertextBytes.set(bytes.subarray(offset, offset + take), copied);
    copied += take;
  }
  return { ...metadata, ciphertextBytes };
}

function writeBlock(bytes: Uint8Array, block: EncryptedLedgerBlockV3S3): void {
  let copied = 0;
  for (const slot of block.bodySlots) {
    const offset = ledgerFileBodySlotOffsetV3S3(slot);
    const take = Math.min(
      LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
      block.ciphertextBytes.byteLength - copied,
    );
    bytes.set(block.ciphertextBytes.subarray(copied, copied + take), offset);
    copied += take;
  }
}

function blockPatches(block: EncryptedLedgerBlockV3S3): LedgerFileBinaryPatchV3S3[] {
  return block.bodySlots.map((slot, index) => {
    const start = index * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES;
    const data = new Uint8Array(LEDGER_FILE_V3_S3_BODY_SLOT_BYTES);
    data.set(block.ciphertextBytes.subarray(start, start + data.byteLength));
    return { position: ledgerFileBodySlotOffsetV3S3(slot), data };
  });
}

function mergeContiguousPatches(
  patches: LedgerFileBinaryPatchV3S3[],
): LedgerFileBinaryPatchV3S3[] {
  const ordered = [...patches].sort(
    (left, right) => left.position - right.position,
  );
  const merged: LedgerFileBinaryPatchV3S3[] = [];
  for (const patch of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.position + previous.data.byteLength === patch.position
    ) {
      const data = new Uint8Array(
        previous.data.byteLength + patch.data.byteLength,
      );
      data.set(previous.data);
      data.set(patch.data, previous.data.byteLength);
      merged[merged.length - 1] = { position: previous.position, data };
    } else {
      merged.push(patch);
    }
  }
  return merged;
}

function blockPaddingIsZero(bytes: Uint8Array, block: EncryptedLedgerBlockV3S3): boolean {
  const usedInLast =
    block.ciphertextBytes.byteLength -
    (block.bodySlots.length - 1) * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES;
  const lastOffset = ledgerFileBodySlotOffsetV3S3(block.bodySlots.at(-1)!);
  return bytes
    .subarray(lastOffset + usedInLast, lastOffset + LEDGER_FILE_V3_S3_BODY_SLOT_BYTES)
    .every((byte) => byte === 0);
}

function encodeHeaderSlot(file: LedgerFileV3S3): Uint8Array {
  const json = createLedgerFileManifestAadV3S3(file);
  const maximumJsonBytes =
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES -
    HEADER_JSON_LENGTH_BYTES -
    LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES;
  if (json.byteLength > maximumJsonBytes) {
    throw new Error("Ledger file V3 S-3 header exceeds its fixed slot");
  }
  const bytes = new Uint8Array(LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES);
  new DataView(bytes.buffer).setUint32(0, json.byteLength, true);
  bytes.set(json, HEADER_JSON_LENGTH_BYTES);
  bytes.set(
    file.manifestAuthTagBytes,
    bytes.byteLength - LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  );
  return bytes;
}

function toHeader(file: LedgerFileV3S3): LedgerFileHeaderV3S3 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    sequence: file.sequence,
    recordsPerBlock: file.recordsPerBlock,
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: file.bodySlotCount,
    crypto: orderedCrypto(file.crypto),
    manifestAuthIvBase64Url: file.manifestAuthIvBase64Url,
    current: generationHeader(file.current),
    previous: file.previous ? previousHeader(file.current, file.previous) : null,
  };
}

function generationHeader(generation: LedgerGenerationV3S3): LedgerGenerationHeaderV3S3 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    controlBlock: blockHeader(generation.controlBlock),
    factBlocks: generation.factBlocks.map(blockHeader),
    openBlockId: generation.openBlockId,
  };
}

function previousHeader(
  current: LedgerGenerationV3S3,
  previous: LedgerGenerationV3S3,
): LedgerPreviousHeaderV3S3 {
  const currentById = new Map(current.factBlocks.map((block) => [block.blockId, block]));
  const previousById = new Map(previous.factBlocks.map((block) => [block.blockId, block]));
  return {
    revisionId: previous.revisionId,
    parentRevisionId: previous.parentRevisionId,
    controlBlock: blockHeader(previous.controlBlock),
    changedFactBlocks: previous.factBlocks
      .filter((block) => {
        const next = currentById.get(block.blockId);
        return !next || !sameBlockHeader(block, next);
      })
      .map(blockHeader),
    currentOnlyBlockIds: current.factBlocks
      .filter(({ blockId }) => !previousById.has(blockId))
      .map(({ blockId }) => blockId),
  };
}

function blockHeader(block: EncryptedLedgerBlockV3S3): LedgerBlockHeaderV3S3 {
  return {
    ...orderedBlockMetadata(block),
    ciphertextByteLength: block.ciphertextBytes.byteLength,
  };
}

function orderedBlockMetadata(block: Omit<EncryptedLedgerBlockV3S3, "ciphertextBytes">) {
  return {
    blockId: block.blockId,
    role: block.role,
    order: block.order,
    sealed: block.sealed,
    recordCount: block.recordCount,
    ledgerSchemaVersion: block.ledgerSchemaVersion,
    ivBase64Url: block.ivBase64Url,
    plaintextByteLength: block.plaintextByteLength,
    bodySlots: [...block.bodySlots],
  };
}

function orderedCrypto(crypto: LedgerFileCryptoV2): LedgerFileCryptoV2 {
  return {
    cryptoVersion: crypto.cryptoVersion,
    kdf: {
      name: crypto.kdf.name,
      hash: crypto.kdf.hash,
      iterations: crypto.kdf.iterations,
      saltBase64Url: crypto.kdf.saltBase64Url,
    },
    cipher: {
      name: crypto.cipher.name,
      keyLength: crypto.cipher.keyLength,
      tagLength: crypto.cipher.tagLength,
    },
  };
}

function uniqueReachableBlocks(file: Pick<LedgerFileV3S3, "current" | "previous">): EncryptedLedgerBlockV3S3[] {
  const blocks = [
    file.current.controlBlock,
    ...file.current.factBlocks,
    ...(file.previous
      ? [file.previous.controlBlock, ...file.previous.factBlocks]
      : []),
  ];
  const byIdentity = new Map<string, EncryptedLedgerBlockV3S3>();
  for (const block of blocks) {
    const key = JSON.stringify(block.bodySlots);
    const existing = byIdentity.get(key);
    if (existing && !sameBlock(existing, block)) {
      throw new Error("Different V3 S-3 blocks overlap the same body slots");
    }
    byIdentity.set(key, block);
  }
  return Array.from(byIdentity.values());
}

function blocksBySlot(generation: LedgerGenerationV3S3): Map<number, EncryptedLedgerBlockV3S3> {
  const result = new Map<number, EncryptedLedgerBlockV3S3>();
  for (const block of [generation.controlBlock, ...generation.factBlocks]) {
    for (const slot of block.bodySlots) result.set(slot, block);
  }
  return result;
}

function sameBlock(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
  return sameBlockHeader(left, right) && sameBytes(left.ciphertextBytes, right.ciphertextBytes);
}

function sameBlockHeader(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
  return (
    left.blockId === right.blockId &&
    left.role === right.role &&
    left.order === right.order &&
    left.sealed === right.sealed &&
    left.recordCount === right.recordCount &&
    left.ledgerSchemaVersion === right.ledgerSchemaVersion &&
    left.ivBase64Url === right.ivBase64Url &&
    left.plaintextByteLength === right.plaintextByteLength &&
    left.bodySlots.length === right.bodySlots.length &&
    left.bodySlots.every((slot, index) => slot === right.bodySlots[index])
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return byteArraysEqual(left, right);
}

function validateCrypto(input: unknown): LedgerFileContractError | null {
  if (
    !isExactObject(input, CRYPTO_KEYS) ||
    !isExactObject(input.kdf, KDF_KEYS) ||
    !isExactObject(input.cipher, CIPHER_KEYS)
  ) {
    return contractError("crypto", "Crypto metadata must use the exact V3 S-3 shape");
  }
  if (
    input.cryptoVersion !== 1 ||
    input.kdf.name !== "PBKDF2" ||
    input.kdf.hash !== "SHA-256" ||
    input.kdf.iterations !== 600_000 ||
    typeof input.kdf.saltBase64Url !== "string" ||
    input.cipher.name !== "AES-GCM" ||
    input.cipher.keyLength !== 256 ||
    input.cipher.tagLength !== 128
  ) {
    return contractError("crypto", "Crypto parameters are unsupported");
  }
  try {
    if (base64UrlToBytes(input.kdf.saltBase64Url).byteLength !== 16) {
      return contractError("crypto.kdf.saltBase64Url", "Salt must be 16 bytes");
    }
  } catch (error) {
    return contractError("crypto.kdf.saltBase64Url", "Salt is not canonical Base64URL", error);
  }
  return null;
}

function writePrefix(bytes: Uint8Array): void {
  bytes.set(LEDGER_FILE_V3_MAGIC);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(LEDGER_FILE_V3_MAGIC.byteLength, LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES, true);
  view.setUint32(LEDGER_FILE_V3_MAGIC.byteLength + 4, LEDGER_FILE_V3_S3_BODY_SLOT_BYTES, true);
}

function expectedFileByteLength(bodySlotCount: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    bodySlotCount * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

function isLogicalFile(input: unknown): input is LedgerFileV3S3 {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.keys(input).sort().join("\0") ===
      [
        "activeHeaderSlot",
        "backupFormatVersion",
        "bodySlotBytes",
        "bodySlotCount",
        "crypto",
        "cryptoVersion",
        "current",
        "fileFormatVersion",
        "fileId",
        "ledgerSchemaVersion",
        "manifestAuthIvBase64Url",
        "manifestAuthTagBytes",
        "previous",
        "recordsPerBlock",
        "sequence",
      ].sort().join("\0") &&
    (input as { manifestAuthTagBytes?: unknown }).manifestAuthTagBytes instanceof Uint8Array
  );
}

function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

function contractError(path: string, message: string, cause?: unknown): LedgerFileContractError {
  return { code: "LEDGER_FILE_INVALID_STRUCTURE", path, message, ...(cause === undefined ? {} : { cause }) };
}

function invalid(path: string, message: string, cause?: unknown): { ok: false; errors: LedgerFileContractError[] } {
  return { ok: false, errors: [contractError(path, message, cause)] };
}
