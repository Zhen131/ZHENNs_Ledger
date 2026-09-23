import type { LedgerData } from "@/core/models";
import type {
  LedgerFactCollection,
  LedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3";
import { LEDGER_FACT_COLLECTIONS } from "./ledgerFileChunkingV3";

export type FactEntry = {
  collection: LedgerFactCollection;
  id: string;
  value: unknown;
};

export function mergeLedgerDataV3S3(
  facts: readonly LedgerBlockPayloadV3S3[],
): LedgerData {
  const merged = emptyLedgerData();
  for (const payload of facts) {
    for (const collection of LEDGER_FACT_COLLECTIONS) {
      collectionArray(merged, collection).push(
        ...collectionArray(payload.ledgerData, collection),
      );
    }
  }
  return merged;
}

export function flattenLedgerData(ledgerData: LedgerData): FactEntry[] {
  return LEDGER_FACT_COLLECTIONS.flatMap((collection) =>
    collectionArray(ledgerData, collection).map((value) => ({
      collection,
      id: factId(value),
      value,
    })),
  );
}

function factId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new Error("Every V4 ledger fact must have a non-empty id");
  }
  return value.id;
}

export function emptyLedgerData(): LedgerData {
  return {
    schemaVersion: 5,
    assets: [],
    trades: [],
    cashEvents: [],
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export function collectionArray(
  ledgerData: LedgerData,
  collection: LedgerFactCollection,
): unknown[] {
  return ledgerData[collection] as unknown[];
}
