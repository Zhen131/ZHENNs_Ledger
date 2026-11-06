/**
 * 这个文件管 S-3 格式检查和写入时共用的小工具。
 * 它不管具体查什么，那在 ledgerFileChunkedContainerV3Parse.ts。
 * 没有特别的决定。
 */

import { byteArraysEqual } from "./byteArraysEqual";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileContractError,
} from "./ledgerFileContract";
import type {
  EncryptedLedgerBlockV3S3,
  LedgerGenerationV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
} from "./ledgerFileChunkedContainerV3";
import { PREFIX_BYTES } from "./ledgerFileChunkedContainerV3Constants";

/**
 * 这个函数列出这一代和上一代用到的全部块。
 * 同一个块只列一次。
 * 举例：两代共用 5 个块、各有 1 个独有 → 答 7 个。
 * 两个不同的块占了同一个内容槽时抛错。
 */
export function uniqueReachableBlocks(file: Pick<LedgerFileV3S3, "current" | "previous">): EncryptedLedgerBlockV3S3[] {
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

/**
 * 这个函数列出一代内容里每个内容槽被哪个块占着。
 * 举例：控制块占 0 号槽、记录块占 1、2 号槽 → 答三项。
 */
export function blocksBySlot(generation: LedgerGenerationV3S3): Map<number, EncryptedLedgerBlockV3S3> {
  const result = new Map<number, EncryptedLedgerBlockV3S3>();
  for (const block of [generation.controlBlock, ...generation.factBlocks]) {
    for (const slot of block.bodySlots) result.set(slot, block);
  }
  return result;
}

/**
 * 这个函数回答：两个块是不是一模一样，连密文也一样？
 * 举例：说明一样、密文差一个字节 → 答不是。
 */
export function sameBlock(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
  return sameBlockHeader(left, right) && sameBytes(left.ciphertextBytes, right.ciphertextBytes);
}

/**
 * 这个函数回答：两个块的说明是不是一样（不比密文）？
 * 举例：编号、顺序、随机数、槽都一样 → 答是。
 */
export function sameBlockHeader(left: EncryptedLedgerBlockV3S3, right: EncryptedLedgerBlockV3S3): boolean {
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

/**
 * 这个函数回答：用这么多内容槽，整份文件应该多少字节。
 * 举例：3 个槽 → 答 3670032。
 */
export function expectedFileByteLength(bodySlotCount: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    bodySlotCount * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

/**
 * 这个函数回答：对象是不是完整的 S-3 文件，字段一个不少？
 * 举例：缺了 manifestAuthTagBytes → 答不是。
 */
export function isLogicalFile(input: unknown): input is LedgerFileV3S3 {
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

/**
 * 这个函数回答：字段名是不是正好这几个，不多不少？
 * 举例：要 ["a", "b"]，给 {a: 1} → 答不是。
 */
export function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * 这个函数回答：这个值能不能当文件里的编号？
 * 要求不空、不全是空格、最多 128 个字。
 * 举例："block-1" → 答能；"" → 答不能。
 */
export function isTechnicalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LEDGER_FILE_OUTER_V2_CONSTANTS.maximumTechnicalIdLength
  );
}

/**
 * 这个函数做一条「结构不对」的错误。
 * 举例：传 "header"、说明 → 答 `LEDGER_FILE_INVALID_STRUCTURE` 那一条。
 */
export function contractError(path: string, message: string, cause?: unknown): LedgerFileContractError {
  return { code: "LEDGER_FILE_INVALID_STRUCTURE", path, message, ...(cause === undefined ? {} : { cause }) };
}

/**
 * 这个函数做一个只含一条「结构不对」错误的失败结果。
 * 举例：传 "header.sequence"、说明 → 答 ok:false 和这一条。
 */
export function invalid(path: string, message: string, cause?: unknown): { ok: false; errors: LedgerFileContractError[] } {
  return { ok: false, errors: [contractError(path, message, cause)] };
}

/**
 * 这个函数做一个只含一条错误的失败结果。
 * 错误代码由调用方给。
 * 举例：传 `LEDGER_FILE_UNSUPPORTED_VERSION`、位置、说明 → 答 ok:false 和这一条。
 */
export function invalidWithCode(
  code: LedgerFileContractError["code"],
  path: string,
  message: string,
): { ok: false; errors: LedgerFileContractError[] } {
  return { ok: false, errors: [{ code, path, message }] };
}
