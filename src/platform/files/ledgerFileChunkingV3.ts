/**
 * 这个文件管分块时用到的几种形状。
 * 包括六种记录列表、一块的内容、一代的分块计划。
 * 它不管怎么分，那在 ledgerFileChunkingV3Plan.ts。
 * 没有特别的决定。
 */

import { type DecryptedLedgerPayloadV4 } from "./ledgerFileContract";
import { type EncryptedLedgerBlockV3S3 } from "./ledgerFileChunkedContainerV3";

/**
 * 要分块存的六种记录列表。
 * 包括资产、买卖、现金、转移、价格、手续费规则。
 */
export const LEDGER_FACT_COLLECTIONS = [
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
] as const;

/** 上面六种记录列表里的任意一种。 */
export type LedgerFactCollection =
  (typeof LEDGER_FACT_COLLECTIONS)[number];

/**
 * 一块解密后的内容，和整本时的形状一样。
 * 保存时间加账本，只是只装这一块的记录。
 */
export type LedgerBlockPayloadV3S3 = DecryptedLedgerPayloadV4;

/**
 * 一个记录块的计划：编号、顺序、封没封、几条。
 * 还有要新写的内容，或原样沿用的旧块。
 */
export type LedgerFactBlockPlanV3S3 = {
  blockId: string;
  order: number;
  sealed: boolean;
  recordCount: number;
  serializedPayload: string | null;
  reusedBlock: EncryptedLedgerBlockV3S3 | null;
};

/**
 * 一代的分块计划：控制块内容、全部记录块计划。
 * 还有没装满的块、是不是全部重建。
 */
export type LedgerGenerationPlanV3S3 = {
  controlSerializedPayload: string;
  factBlocks: LedgerFactBlockPlanV3S3[];
  openBlockId: string | null;
  fullRebuild: boolean;
};
