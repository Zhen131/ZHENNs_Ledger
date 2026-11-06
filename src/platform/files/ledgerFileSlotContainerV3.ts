/**
 * 这个文件管文件格式 3 第二步（S-2）的整份文件形状。
 * 包括两个文件头槽、三个内容槽。
 * 现在的程序只读写 S-3 分块那种。
 * 这份 S-2 格式只剩测试辅助代码在用。
 * 不显然的决定。
 * 保存时只写新的那一槽，上一代所在的槽一个字节都不碰。2026-09-01 定（W15 06B 修订 E 第 E.1 节）。
 */

import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";
import { PREFIX_BYTES } from "./ledgerFileSlotContainerV3Constants";

/** 每个文件头槽的大小：256 KiB。为什么是这个数：这是猜的，日志里没写，要核。 */
export const LEDGER_FILE_HEADER_SLOT_BYTES = 256 * 1024;
/**
 * 内容槽有几个：3 个。
 * 为什么是 3：这一代、上一代各占一个，还要空一个给下次写。这是猜的，日志里没写，要核。
 */
export const LEDGER_FILE_BODY_SLOT_COUNT = 3 as const;
/** 每个内容槽最少多大：64 KiB。为什么是这个数：这是猜的，日志里没写，要核。 */
export const LEDGER_FILE_BODY_SLOT_MIN_BYTES = 64 * 1024;
const LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES = 64 * 1024;

/** S-2 格式写在明文外层的版本号和槽的大小上限。 */
export const LEDGER_FILE_OUTER_V3_S2_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerSlotBytes: LEDGER_FILE_HEADER_SLOT_BYTES,
  bodySlotCount: LEDGER_FILE_BODY_SLOT_COUNT,
  maximumBodySlotBytes: LEDGER_FILE_OUTER_V2_CONSTANTS.maximumCiphertextBytes,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

/** 文件头槽的编号：0 或 1。 */
export type LedgerFileHeaderSlotV3S2 = 0 | 1;
/** 内容槽的编号：0、1 或 2。 */
export type LedgerFileBodySlotV3S2 = 0 | 1 | 2;

/** S-2 格式里的一代加密内容，还记着它放在哪个内容槽。 */
export type EncryptedLedgerGenerationV3S2 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  bodySlot: LedgerFileBodySlotV3S2;
  ivBase64Url: string;
  ciphertextBytes: Uint8Array;
};

/**
 * S-2 格式的整份文件。
 * 有版本号、编号、写到第几次、哪个文件头槽在用。
 * 还有槽多大、这一代和上一代。
 */
export type LedgerFileV3S2 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  activeHeaderSlot: LedgerFileHeaderSlotV3S2;
  bodySlotBytes: number;
  bodySlotCount: 3;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3S2;
  previous: EncryptedLedgerGenerationV3S2 | null;
};

/** 检查一份 S-2 文件的结果：通过就给出文件，不通过就给出错误。 */
export type LedgerFileV3S2ValidationResult =
  | { ok: true; value: LedgerFileV3S2 }
  | { ok: false; errors: LedgerFileContractError[] };

/**
 * 从某个文件头槽读出来、可能能用的一份文件。
 * 连同两个槽的空白是不是全 0。
 */
export type LedgerFileV3S2HeaderCandidate = {
  file: LedgerFileV3S2;
  currentPaddingIsZero: boolean;
  previousPaddingIsZero: boolean;
};

/** 一个文件头槽读出来的状态：空的、坏的、或者能用。 */
export type LedgerFileV3S2HeaderSlotState =
  | { slot: LedgerFileHeaderSlotV3S2; status: "empty" }
  | {
      slot: LedgerFileHeaderSlotV3S2;
      status: "invalid";
      errors: LedgerFileContractError[];
    }
  | {
      slot: LedgerFileHeaderSlotV3S2;
      status: "candidate";
      candidate: LedgerFileV3S2HeaderCandidate;
    };

/** 两个文件头槽都读完的结果：能用的那几份，加每个槽的状态。 */
export type LedgerFileV3S2CandidatesResult =
  | {
      ok: true;
      value: {
        candidates: LedgerFileV3S2HeaderCandidate[];
        headerSlots: [
          LedgerFileV3S2HeaderSlotState,
          LedgerFileV3S2HeaderSlotState,
        ];
      };
    }
  | { ok: false; errors: LedgerFileContractError[] };

/** 一处局部写入：从第几个字节开始，写哪些字节。 */
export type LedgerFileBinaryPatchV3S2 = {
  position: number;
  data: Uint8Array;
};

/**
 * 准备好的一次 S-2 保存。
 * 有新文件、整份字节、整份重写还是局部写入。
 * 还有要写的几处。
 */
export type PreparedLedgerFileV3S2Write = {
  file: LedgerFileV3S2;
  serializedFile: Uint8Array;
  mode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S2[];
};

/**
 * 这个函数回答。
 * 这串字节是不是以文件格式 3 的识别字节开头？
 * 举例：开头是 "LFTL3\r\n\0" → 答是。
 */
export function isLedgerFileV3S2Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

/**
 * 这个函数回答：要装这么多密文，内容槽该开多大？
 * 放得下就沿用原来的大小；放不下就至少留 25% 余量，或翻倍。
 * 结果按 64 KiB 取整，不超过上限。
 * 举例：密文 100000 字节、原来没有槽 → 答 131072（128 KiB）。
 * 密文太小、太大或不是整数时抛错。
 */
export function chooseLedgerFileBodySlotBytesV3S2(
  requiredCiphertextBytes: number,
  currentBodySlotBytes?: number,
): number {
  if (
    !Number.isSafeInteger(requiredCiphertextBytes) ||
    requiredCiphertextBytes < LEDGER_FILE_OUTER_V2_CONSTANTS.minimumCiphertextBytes ||
    requiredCiphertextBytes > LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  ) {
    throw new Error("Ledger file V3 S-2 ciphertext cannot fit a body slot");
  }
  if (
    currentBodySlotBytes !== undefined &&
    requiredCiphertextBytes <= currentBodySlotBytes
  ) {
    return currentBodySlotBytes;
  }

  const headroomTarget = Math.ceil(requiredCiphertextBytes * 1.25);
  const growthTarget = currentBodySlotBytes
    ? Math.max(headroomTarget, currentBodySlotBytes * 2)
    : Math.max(headroomTarget, LEDGER_FILE_BODY_SLOT_MIN_BYTES);
  const boundedTarget = Math.min(
    growthTarget,
    LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes,
  );
  if (
    boundedTarget === LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes
  ) {
    return boundedTarget;
  }
  const aligned = Math.ceil(
    boundedTarget / LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES,
  ) * LEDGER_FILE_BODY_SLOT_ALIGNMENT_BYTES;
  return Math.min(
    aligned,
    LEDGER_FILE_OUTER_V3_S2_CONSTANTS.maximumBodySlotBytes,
  );
}

/** 这个函数回答另一个文件头槽是几号。举例：0 → 答 1。 */
export function otherLedgerFileHeaderSlotV3S2(
  slot: LedgerFileHeaderSlotV3S2,
): LedgerFileHeaderSlotV3S2 {
  return slot === 0 ? 1 : 0;
}

/**
 * 这个函数回答：下次保存该写进哪个内容槽？要选这一代和上一代都没占的那个。
 * 举例：这一代在 0、上一代在 1 → 答 2。
 * 三个槽都被占时抛错。
 */
export function nextLedgerFileBodySlotV3S2(
  file: Pick<LedgerFileV3S2, "current" | "previous">,
): LedgerFileBodySlotV3S2 {
  const occupied = new Set<LedgerFileBodySlotV3S2>([
    file.current.bodySlot,
    ...(file.previous ? [file.previous.bodySlot] : []),
  ]);
  const available = ([0, 1, 2] as const).find(
    (slot) => !occupied.has(slot),
  );
  if (available === undefined) {
    throw new Error("V3 S-2 file has no safe body slot for its next write");
  }
  return available;
}

/**
 * 这个函数回答：某个文件头槽从文件第几个字节开始。
 * 举例：1 号槽 → 答 16 + 262144 = 262160。
 */
export function ledgerFileHeaderSlotOffsetV3S2(
  slot: LedgerFileHeaderSlotV3S2,
): number {
  return PREFIX_BYTES + slot * LEDGER_FILE_HEADER_SLOT_BYTES;
}

/**
 * 这个函数回答：某个内容槽从文件第几个字节开始。
 * 举例：槽 64 KiB、2 号槽 → 答 16 + 524288 + 131072 = 655376。
 */
export function ledgerFileBodySlotOffsetV3S2(
  bodySlotBytes: number,
  slot: LedgerFileBodySlotV3S2,
): number {
  return (
    PREFIX_BYTES +
    LEDGER_FILE_HEADER_SLOT_BYTES * 2 +
    slot * bodySlotBytes
  );
}
