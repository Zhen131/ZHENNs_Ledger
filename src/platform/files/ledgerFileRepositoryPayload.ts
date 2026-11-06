/**
 * 这个文件管存账本文件时，内容层面的几个小工具。
 * 包括换保存时间、只加一笔买卖、比两代。
 * 它不管加密和写盘，那在 ledgerFileRepositoryWrite.ts。
 * 没有特别的决定。
 */

import { byteArraysEqual } from "./byteArraysEqual";
import { type CanonicalLedgerPayloadV4 } from "./ledgerFileContract";
import {
  createCanonicalLedgerPayloadV4,
  evaluateLedgerFilePayloadByteLength,
} from "./ledgerFileContractPayload";
import {
  type EncryptedLedgerBlockV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import type { LedgerData, Trade } from "@/core/models";
import {
  evaluateLedgerResourcePolicyAfterTradeAppend,
} from "@/core/validation";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";

/** 这个函数回答：两串字节是不是一个不差。举例：[1, 2] 和 [1, 2] → 答是。 */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return byteArraysEqual(left, right);
}

/**
 * 这个函数把一份检查过的内容换上新的保存时间。
 * 账本部分原样不动。
 * 举例：保存时间换成 "2026-11-06T09:00:00Z" → 答只有时间变了的内容。
 * 换完超过文件大小上限时抛 `LedgerFileRepositoryError`。
 */
export function retimeCanonicalLedgerPayloadV4(
  payload: CanonicalLedgerPayloadV4,
  savedAt: string,
): CanonicalLedgerPayloadV4 {
  const value = {
    savedAt,
    ledgerData: payload.value.ledgerData,
  };
  const serializedPayload = serializeCanonicalPayload(
    savedAt,
    payload.serializedLedgerData,
  );
  const byteResult = evaluateLedgerFilePayloadByteLength(
    serializedPayload,
  );
  if (!byteResult.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
      "Ledger data failed the file payload resource policy after retiming",
      byteResult.errors,
    );
  }
  return {
    value,
    serializedPayload,
    serializedLedgerData: payload.serializedLedgerData,
  };
}

/**
 * 这个函数回答。
 * 旧账本后面接上一笔新买卖，要存的内容是什么？
 * 只查新这一笔和大小上限，不把旧账本整本重查。
 * 举例：旧账本 1000 笔，新记 1 笔 → 答 1001 笔的内容。
 * 这一笔查不过或超上限时答 null，调用方改走整本保存。
 *
 * 为什么只查新这一笔：整本重查太慢。这是猜的，日志里没写，要核。
 */
export function createCanonicalPayloadAfterBuyTrade(
  base: LedgerData,
  trade: Trade,
  savedAt: string,
): CanonicalLedgerPayloadV4 | null {
  const focused = createCanonicalLedgerPayloadV4(
    {
      schemaVersion: 5,
      assets: base.assets,
      trades: [trade],
      cashEvents: [],
      assetTransfers: [],
      priceSnapshots: [],
      feeRules: base.feeRules,
    },
    savedAt,
  );
  if (!focused.ok) return null;
  const validatedTrade = focused.value.value.ledgerData.trades[0];
  if (!validatedTrade) return null;

  const ledgerData: LedgerData = {
    schemaVersion: 5,
    assets: base.assets,
    trades: [...base.trades, validatedTrade],
    cashEvents: base.cashEvents,
    assetTransfers: base.assetTransfers,
    priceSnapshots: base.priceSnapshots,
    feeRules: base.feeRules,
  };
  const resourceResult =
    evaluateLedgerResourcePolicyAfterTradeAppend(
      ledgerData,
      validatedTrade,
    );
  if (!resourceResult.ok) return null;

  const value = { savedAt, ledgerData };
  const serializedLedgerData = JSON.stringify(ledgerData);
  const serializedPayload = serializeCanonicalPayload(
    savedAt,
    serializedLedgerData,
  );
  const byteResult = evaluateLedgerFilePayloadByteLength(
    serializedPayload,
  );
  if (!byteResult.ok) return null;
  return { value, serializedPayload, serializedLedgerData };
}

/**
 * 这个函数列出账本里全部记录的编号。
 * 举例：1 个资产、2 笔买卖 → 答 3 个编号。
 */
export function collectLedgerFactIds(ledgerData: LedgerData): Set<string> {
  return new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function serializeCanonicalPayload(
  savedAt: string,
  serializedLedgerData: string,
): string {
  return `{"savedAt":${JSON.stringify(savedAt)},"ledgerData":${serializedLedgerData}}`;
}

/**
 * 这个函数回答：两代内容的说明和每个块是不是完全一样。
 * 举例：只有一个块的随机数不同 → 答不是。
 */
export function sameGeneration(
  left: LedgerGenerationV3S3,
  right: LedgerGenerationV3S3,
): boolean {
  return (
    left.revisionId === right.revisionId &&
    left.parentRevisionId === right.parentRevisionId &&
    left.openBlockId === right.openBlockId &&
    sameEncryptedBlock(left.controlBlock, right.controlBlock) &&
    left.factBlocks.length === right.factBlocks.length &&
    left.factBlocks.every((block, index) =>
      sameEncryptedBlock(block, right.factBlocks[index]!),
    )
  );
}

/**
 * 这个函数回答：两个加密块是不是完全一样，连密文也一样。
 * 举例：说明一样、密文差一个字节 → 答不是。
 */
export function sameEncryptedBlock(
  left: EncryptedLedgerBlockV3S3,
  right: EncryptedLedgerBlockV3S3,
): boolean {
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
    left.bodySlots.every((slot, index) => slot === right.bodySlots[index]) &&
    sameBytes(left.ciphertextBytes, right.ciphertextBytes)
  );
}
