import { type DecryptedLedgerPayloadV4 } from "./ledgerFileContract";
import { type EncryptedLedgerBlockV3S3 } from "./ledgerFileChunkedContainerV3";

export const LEDGER_FACT_COLLECTIONS = [
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
] as const;

export type LedgerFactCollection =
  (typeof LEDGER_FACT_COLLECTIONS)[number];

export type LedgerBlockPayloadV3S3 = DecryptedLedgerPayloadV4;

export type LedgerFactBlockPlanV3S3 = {
  blockId: string;
  order: number;
  sealed: boolean;
  recordCount: number;
  serializedPayload: string | null;
  reusedBlock: EncryptedLedgerBlockV3S3 | null;
};

export type LedgerGenerationPlanV3S3 = {
  controlSerializedPayload: string;
  factBlocks: LedgerFactBlockPlanV3S3[];
  openBlockId: string | null;
  fullRebuild: boolean;
};
