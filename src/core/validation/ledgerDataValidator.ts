/**
 * 这个文件管一件事：一整本账本收下之前从头到尾查一遍。
 * 每种记录怎么查交给同目录的 ledgerDataValidator 开头的几个文件。
 * 不显然的决定：出现不认识的字段就拒绝，不悄悄丢掉。2026-08-19 定（W14 01B 第 3.5 节）。
 */

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

type IndexedValidatedLedgerTrade = Readonly<{
  originalIndex: number;
  trade: Readonly<Trade>;
}>;

/**
 * 这个函数从程序里的账本对象中，只挑出要存的七样。
 * 七样是结构版本号和六种记录列表，多余的东西不带。
 * 举例：对象多了一个界面用的字段 → 答的结果里没有它。
 * 不是对象时原样返回，留给 validateLedgerData 去报错。
 * 从文件或备份导入时不用它，直接交给 validateLedgerData 严格查。
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

/**
 * 这个函数回答：这一整本账本能不能收？不能的话错在哪几处？
 * 它查结构版本、每条记录、编号重复、引用对不对。
 * 最后查买卖顺序。
 * 举例：结构版本是 4 → 答不能收，`LEDGER_DATA_UNSUPPORTED_SCHEMA_VERSION`。
 * 举例：某笔卖出比手里多 → 答不能收，`LEDGER_DATA_INVALID_TRADE_TIMELINE`。
 *
 * 为什么低版本直接拒绝：Alpha 阶段不做迁移。
 * 2026-08-27 定（W15 版本分层与迁移策略决策记录第三节）。
 *
 * 出错时不抛错，返回 ok:false 和全部错误。
 * 调用方拿到后不打开、不改文件，把错误告诉人。
 */
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

/**
 * 这个函数从一本不一定合法的账本里，挑出读得懂的买卖。
 * 每笔都带着它在原列表里的位置。
 * 举例：第 0 笔合法、第 1 笔缺数量 → 答只有第 0 笔。
 * 不抛错；整本读不懂时答空列表。
 */
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
