/**
 * 这个文件管现在真正在用的账本文件格式。
 * 文件格式 3 第三步（S-3），按块存。
 * 它不管怎么分块，那在 ledgerFileChunkingV3Plan.ts；也不管加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定：按条数分块，每块单独加密，块间不串。2026-08-31 定（W15 06A 第 2.1、2.2 节）。
 */

import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import { PREFIX_BYTES } from "./ledgerFileChunkedContainerV3Constants";

/**
 * 每个块最多装多少条记录：2000 条。
 * 为什么是 2000：实测达标后定下，没为更大的账本放大。2026-09-01 定（W15 06C 第 R-5 节）。
 */
export const RECORDS_PER_LEDGER_BLOCK = 2_000;
/**
 * 每个文件头槽的大小：256 KiB。
 * 为什么是这个数：够放两代的块清单，还有余量。2026-09-01 定（W15 06C 第 R-2 节 F-1）。
 */
export const LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES = 256 * 1024;
/**
 * 每个内容槽的大小：1 MiB。一个块可以占一个或几个槽。
 * 为什么是这个数：2026-09-01 定（W15 06C 第 R-2 节 F-1）。
 */
export const LEDGER_FILE_V3_S3_BODY_SLOT_BYTES = 1024 * 1024;
/**
 * 文件头槽末尾那段块清单验证码的长度：16 字节。
 * 为什么是 16：AES-GCM 默认的验证码就是这么长。2026-09-01 定（W15 06C 第 R-2 节 F-3）。
 */
export const LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES = 16;

/**
 * S-3 格式写在明文外层的四个版本号。
 * 和槽的大小、整份文件的上限，取自上面几个常量。
 * 为什么放明文外层：低版本要能在解密前认出来。2026-08-27 定（W15 版本分层与迁移策略决策记录第二节）。
 */
export const LEDGER_FILE_OUTER_V3_S3_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerSlotBytes: LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

/** 文件头槽的编号：0 或 1。 */
export type LedgerFileHeaderSlotV3S3 = 0 | 1;
/** 块的种类：控制块（记保存时间）或记录块（装买卖等记录）。 */
export type LedgerFileBlockRoleV3S3 = "control" | "facts";

/**
 * 一个加密好的块。
 * 记着编号、种类、顺序、封没封、几条记录。
 * 还有随机数、占哪些槽、密文。
 */
export type EncryptedLedgerBlockV3S3 = {
  blockId: string;
  role: LedgerFileBlockRoleV3S3;
  order: number;
  sealed: boolean;
  recordCount: number;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  plaintextByteLength: number;
  bodySlots: number[];
  ciphertextBytes: Uint8Array;
};

/**
 * 一代内容。
 * 有版本编号、上一代编号、控制块、全部记录块。
 * 还记着哪个块没装满。
 */
export type LedgerGenerationV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: EncryptedLedgerBlockV3S3;
  factBlocks: EncryptedLedgerBlockV3S3[];
  openBlockId: string | null;
};

/**
 * S-3 格式的整份文件。
 * 有四个版本号、编号、写到第几次、哪个头槽在用。
 * 还有槽的大小和数量。
 * 还有加密参数、块清单验证码、这一代和上一代。
 */
export type LedgerFileV3S3 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
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

/** 检查一份 S-3 文件的结果：通过就给出文件，不通过就给出错误。 */
export type LedgerFileV3S3ValidationResult =
  | { ok: true; value: LedgerFileV3S3 }
  | { ok: false; errors: LedgerFileContractError[] };

/**
 * 从某个文件头槽读出来、可能能用的一份文件。
 * 连同它用到的槽空白处是不是全 0。
 */
export type LedgerFileV3S3HeaderCandidate = {
  file: LedgerFileV3S3;
  headerSlot: LedgerFileHeaderSlotV3S3;
  referencedPaddingIsZero: boolean;
};

/**
 * 两个头槽都读完的结果。
 * 能用的那几份，加它们一共用到哪些内容槽。
 */
export type LedgerFileV3S3CandidatesResult =
  | {
      ok: true;
      value: {
        candidates: LedgerFileV3S3HeaderCandidate[];
        reachableBodySlots: number[];
      };
    }
  | { ok: false; errors: LedgerFileContractError[] };

/** 一处局部写入：从第几个字节开始，写哪些字节。 */
export type LedgerFileBinaryPatchV3S3 = {
  position: number;
  data: Uint8Array;
};

/**
 * 准备好的一次 S-3 保存。
 * 有新文件、整份字节、整份重写还是局部写入。
 * 还有要写的几处。
 */
export type PreparedLedgerFileV3S3Write = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  mode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
};

/**
 * 这个函数回答：这串字节开头是不是格式 3 的识别字节？
 * 举例：开头是 "LFTL3\r\n\0" → 答是。
 */
export function isLedgerFileV3S3Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

/** 这个函数回答另一个文件头槽是几号。举例：1 → 答 0。 */
export function otherLedgerFileHeaderSlotV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): LedgerFileHeaderSlotV3S3 {
  return slot === 0 ? 1 : 0;
}

/**
 * 这个函数回答：某个文件头槽从文件第几个字节开始。
 * 举例：1 号槽 → 答 16 + 262144 = 262160。
 */
export function ledgerFileHeaderSlotOffsetV3S3(
  slot: LedgerFileHeaderSlotV3S3,
): number {
  return PREFIX_BYTES + slot * LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES;
}

/**
 * 这个函数回答：某个内容槽从文件第几个字节开始。
 * 举例：3 号槽 → 答 16 + 524288 + 3 × 1048576 = 3670032。
 */
export function ledgerFileBodySlotOffsetV3S3(slot: number): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    slot * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES
  );
}

/**
 * 这个函数回答：这么长的密文要占几个 1 MiB 的内容槽？
 * 举例：1500000 字节 → 答 2 个。
 * 长度不是整数或小于 16 字节时抛错。
 */
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
