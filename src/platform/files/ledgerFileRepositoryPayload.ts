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

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return byteArraysEqual(left, right);
}

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
