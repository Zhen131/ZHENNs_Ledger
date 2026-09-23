import { calculatePositions } from "@/core/calculations";
import type {
  Asset,
  AssetTransfer,
  CashEvent,
  FeeRule,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import { readAsset } from "./ledgerDataValidatorAsset";
import { readAssetTransfer } from "./ledgerDataValidatorAssetTransfer";
import { readCashEvent } from "./ledgerDataValidatorCashEvent";
import { readFeeRule } from "./ledgerDataValidatorFeeRule";
import {
  validateGlobalIdentifiers,
  validateUniqueAssetSymbols,
  validateReferences,
} from "./ledgerDataValidatorIntegrity";
import { readPriceSnapshot } from "./ledgerDataValidatorPrice";
import {
  checkExactKeys,
  isRecord,
  createError,
} from "./ledgerDataValidatorReaders";
import type {
  LedgerDataValidationError,
  LedgerDataValidationResult,
} from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  ROOT_KEYS,
} from "./ledgerDataValidatorSchema";
import { readTrade } from "./ledgerDataValidatorTrade";

export type IndexedValidatedLedgerTrade = Readonly<{
  originalIndex: number;
  trade: Readonly<Trade>;
}>;

/**
 * Persistence exports accept the live application object but serialize only
 * the seven canonical V4 fact fields. Import validation remains exact and must
 * call validateLedgerData directly.
 */
export function selectLedgerDataFacts(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    schemaVersion: input.schemaVersion,
    assets: input.assets,
    trades: input.trades,
    cashEvents: input.cashEvents,
    assetTransfers: input.assetTransfers,
    priceSnapshots: input.priceSnapshots,
    feeRules: input.feeRules,
  };
}

export function validateLedgerData(input: unknown): LedgerDataValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ROOT,
          "ledgerData",
          "LedgerData must be an object",
        ),
      ],
    };
  }

  const errors: LedgerDataValidationError[] = [];
  checkExactKeys(input, ROOT_KEYS, "ledgerData", errors);
  if (input.schemaVersion !== 5) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
        "schemaVersion",
        `Unsupported schema version: ${String(input.schemaVersion)}`,
      ),
    );
  }

  const rawAssets = readCollection(input, "assets", errors);
  const rawTrades = readCollection(input, "trades", errors);
  const rawCashEvents = readCollection(input, "cashEvents", errors);
  const rawAssetTransfers = readCollection(input, "assetTransfers", errors);
  const rawPriceSnapshots = readCollection(input, "priceSnapshots", errors);
  const rawFeeRules = readCollection(input, "feeRules", errors);
  if (
    rawAssets === undefined ||
    rawTrades === undefined ||
    rawCashEvents === undefined ||
    rawAssetTransfers === undefined ||
    rawPriceSnapshots === undefined ||
    rawFeeRules === undefined
  ) {
    return { ok: false, errors };
  }

  const assets = rawAssets
    .map((value, index) => readAsset(value, index, errors))
    .filter((value): value is Asset => value !== undefined);
  const feeRules = rawFeeRules
    .map((value, index) => readFeeRule(value, index, assets, errors))
    .filter((value): value is FeeRule => value !== undefined);
  const trades = rawTrades
    .map((value, index) => readTrade(value, index, assets, errors))
    .filter((value): value is Trade => value !== undefined);
  const cashEvents = rawCashEvents
    .map((value, index) => readCashEvent(value, index, errors))
    .filter((value): value is CashEvent => value !== undefined);
  const assetTransfers = rawAssetTransfers
    .map((value, index) => readAssetTransfer(value, index, errors))
    .filter((value): value is AssetTransfer => value !== undefined);
  const priceSnapshots = rawPriceSnapshots
    .map((value, index) => readPriceSnapshot(value, index, assets, errors))
    .filter((value): value is PriceSnapshot => value !== undefined);

  validateGlobalIdentifiers(
    { assets, trades, cashEvents, assetTransfers, priceSnapshots, feeRules },
    errors,
  );
  validateUniqueAssetSymbols(assets, errors);
  validateReferences(
    trades,
    assetTransfers,
    priceSnapshots,
    feeRules,
    assets,
    errors,
  );

  if (
    errors.length === 0 &&
    assets.length === rawAssets.length &&
    trades.length === rawTrades.length &&
    cashEvents.length === rawCashEvents.length &&
    assetTransfers.length === rawAssetTransfers.length &&
    priceSnapshots.length === rawPriceSnapshots.length &&
    feeRules.length === rawFeeRules.length
  ) {
    try {
      calculatePositions(trades, priceSnapshots, assetTransfers);
    } catch (error) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_TRADE_TIMELINE,
          "trades",
          error instanceof Error
            ? error.message
            : "Trade timeline cannot be calculated",
        ),
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 5,
      assets,
      trades,
      cashEvents,
      assetTransfers,
      priceSnapshots,
      feeRules,
    },
  };
}

export function collectValidLedgerTradeProjections(
  input: unknown,
): readonly IndexedValidatedLedgerTrade[] {
  if (!isRecord(input)) return [];
  const errors: LedgerDataValidationError[] = [];
  const rawAssets = readCollection(input, "assets", errors);
  const rawTrades = readCollection(input, "trades", errors);
  if (rawAssets === undefined || rawTrades === undefined) return [];
  const assets = rawAssets
    .map((value, index) => readAsset(value, index, errors))
    .filter((value): value is Asset => value !== undefined);
  const projections: IndexedValidatedLedgerTrade[] = [];
  rawTrades.forEach((value, originalIndex) => {
    const trade = readTrade(value, originalIndex, assets, errors);
    if (trade !== undefined) projections.push({ originalIndex, trade });
  });
  return projections;
}

function readCollection(
  input: Record<string, unknown>,
  field:
    | "assets"
    | "trades"
    | "cashEvents"
    | "assetTransfers"
    | "priceSnapshots"
    | "feeRules",
  errors: LedgerDataValidationError[],
): unknown[] | undefined {
  const value = input[field];
  if (Array.isArray(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_COLLECTION,
      field,
      `${field} must be an array`,
    ),
  );
  return undefined;
}
