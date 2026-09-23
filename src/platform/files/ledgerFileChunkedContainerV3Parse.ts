import { base64UrlToBytes } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import type {
  LedgerFileHeaderSlotV3S3,
  LedgerFileBlockRoleV3S3,
  EncryptedLedgerBlockV3S3,
  LedgerGenerationV3S3,
  LedgerFileV3S3,
  LedgerFileV3S3ValidationResult,
  LedgerFileV3S3HeaderCandidate,
  LedgerFileV3S3CandidatesResult,
} from "./ledgerFileChunkedContainerV3";
import {
  RECORDS_PER_LEDGER_BLOCK,
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  LEDGER_FILE_OUTER_V3_S3_CONSTANTS,
  isLedgerFileV3S3Bytes,
  ledgerFileHeaderSlotOffsetV3S3,
  ledgerFileBodySlotOffsetV3S3,
  ledgerFileBodySlotsRequiredV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  PREFIX_BYTES,
  HEADER_JSON_LENGTH_BYTES,
  HEADER_KEYS,
  GENERATION_KEYS,
  PREVIOUS_KEYS,
  BLOCK_HEADER_KEYS,
  CRYPTO_KEYS,
  KDF_KEYS,
  CIPHER_KEYS,
} from "./ledgerFileChunkedContainerV3Constants";
import type {
  LedgerBlockHeaderV3S3,
  LedgerGenerationHeaderV3S3,
  LedgerPreviousHeaderV3S3,
  LedgerFileHeaderV3S3,
} from "./ledgerFileChunkedContainerV3Header";
import { generationHeader } from "./ledgerFileChunkedContainerV3Header";
import {
  uniqueReachableBlocks,
  blocksBySlot,
  sameBlock,
  expectedFileByteLength,
  isLogicalFile,
  isExactObject,
  isTechnicalId,
  contractError,
  invalid,
  invalidWithCode,
} from "./ledgerFileChunkedContainerV3Shared";

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
    input.ledgerSchemaVersion !== 5 ||
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
  if (input.ledgerSchemaVersion === 4) {
    return invalidWithCode(
      "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4",
      "header.ledgerSchemaVersion",
      "This file contains a V4 ledger; V5 does not provide migration",
    );
  }
  if (
    input.fileFormatVersion !== 3 ||
    input.cryptoVersion !== 1 ||
    input.ledgerSchemaVersion !== 5 ||
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
      ledgerSchemaVersion: 5,
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

function blockPaddingIsZero(bytes: Uint8Array, block: EncryptedLedgerBlockV3S3): boolean {
  const usedInLast =
    block.ciphertextBytes.byteLength -
    (block.bodySlots.length - 1) * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES;
  const lastOffset = ledgerFileBodySlotOffsetV3S3(block.bodySlots.at(-1)!);
  return bytes
    .subarray(lastOffset + usedInLast, lastOffset + LEDGER_FILE_V3_S3_BODY_SLOT_BYTES)
    .every((byte) => byte === 0);
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
