import { isValidISODateOrDateTime } from "@/core/validation";
import { type CanonicalLedgerPayloadV4 } from "./ledgerFileContract";
import { createCanonicalLedgerPayloadV4 } from "./ledgerFileContractPayload";
import type {
  LedgerFactCollection,
  LedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3";
import { LEDGER_FACT_COLLECTIONS } from "./ledgerFileChunkingV3";
import {
  mergeLedgerDataV3S3,
  flattenLedgerData,
} from "./ledgerFileChunkingV3Shared";

export function parseLedgerBlockPayloadV3S3(
  serialized: string,
  role: "control" | "facts",
  expectedRecordCount: number,
): LedgerBlockPayloadV3S3 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Decrypted V3 S-3 block is not valid JSON", {
      cause: error,
    });
  }
  if (
    !isExactObject(parsed, ["ledgerData", "savedAt"] as const) ||
    typeof parsed.savedAt !== "string" ||
    !parsed.savedAt.includes("T") ||
    !isValidISODateOrDateTime(parsed.savedAt) ||
    !isExactObject(parsed.ledgerData, [
      "assetTransfers",
      "assets",
      "cashEvents",
      "feeRules",
      "priceSnapshots",
      "schemaVersion",
      "trades",
    ] as const) ||
    parsed.ledgerData.schemaVersion !== 5 ||
    !LEDGER_FACT_COLLECTIONS.every((key) =>
      Array.isArray(
        (parsed.ledgerData as Record<LedgerFactCollection, unknown>)[key],
      ),
    )
  ) {
    throw new Error("Decrypted V3 S-3 block does not use the V4 payload shape");
  }
  const payload = parsed as LedgerBlockPayloadV3S3;
  const facts = flattenLedgerData(payload.ledgerData);
  if (
    facts.length !== expectedRecordCount ||
    (role === "control" && facts.length !== 0) ||
    (role === "facts" && facts.length === 0) ||
    JSON.stringify(payload) !== serialized
  ) {
    throw new Error("Decrypted V3 S-3 block count or canonical encoding is invalid");
  }
  return payload;
}

export function mergeBlockPayloadsV3S3(
  control: LedgerBlockPayloadV3S3,
  facts: readonly LedgerBlockPayloadV3S3[],
): CanonicalLedgerPayloadV4 {
  const merged = mergeLedgerDataV3S3(facts);
  const result = createCanonicalLedgerPayloadV4(merged, control.savedAt);
  if (!result.ok) {
    throw new Error("Merged V3 S-3 blocks failed the canonical V4 payload contract", {
      cause: result.errors,
    });
  }
  return result.value;
}

function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
