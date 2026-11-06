/**
 * 这个文件管一件事：给来的一条价格能不能收进账本。
 * 它不管单个字段怎么读，那在 priceSnapshotValidatorReaders.ts。
 * 不显然的决定：新的价格只收 USDT。2026-08-19 定（W14 01B 第 3.1 节）。
 */

import type { Asset, PriceSnapshotDraft } from "@/core/models";
import { isLedgerFactInFuture } from "@/core/shared";
import { isSupportedValuationCurrency } from "@/core/policies";
import type {
  PriceSnapshotValidationError,
} from "./priceSnapshotValidatorErrors";
import {
  PRICE_SNAPSHOT_VALIDATION_ERROR_CODES,
} from "./priceSnapshotValidatorErrors";
import {
  readOptionalOccurredTimeZone,
  readBinanceProvenance,
  isRecord,
  readAssetSymbol,
  readPositivePrice,
  readRequiredString,
  readRecordedAt,
  readSource,
  readOptionalNote,
  createError,
} from "./priceSnapshotValidatorReaders";

/** 检查通过的一条价格，币种一定是 USDT。 */
type ValidatedPriceSnapshotDraft = Omit<
  PriceSnapshotDraft,
  "currency"
> & {
  currency: "USDT";
};

/**
 * 检查结果：通过就给出整理好的一条。
 * 不通过就给出全部错误。
 */
type PriceSnapshotValidationResult =
  | {
      ok: true;
      value: ValidatedPriceSnapshotDraft;
    }
  | {
      ok: false;
      errors: PriceSnapshotValidationError[];
    };

/**
 * 检查一条价格时可以打开的几个开关。
 * 有今天是哪天、只收 USDT、行情价必须带来历。
 */
type PriceSnapshotValidationOptions = {
  todayKey?: string;
  requireSupportedValuationCurrency?: boolean;
  requireApiProvenance?: boolean;
  requiredCurrency?: string;
};

/**
 * 这个函数回答：这条价格能不能收进账本？不能的话错在哪几处？
 * 举例：BTC、70000、USDT、2026-08-20、手动 → 答通过。
 * 举例：日期比今天晚，且传了今天 → 答不通过，`PRICE_SNAPSHOT_FUTURE_FACT`。
 * 举例：币种填 USD → 答不通过，`PRICE_SNAPSHOT_NEW_FACT_REQUIRES_USDT`。
 * 出错时不抛错，返回 ok:false 和全部错误。
 */
export function validatePriceSnapshotDraft(
  input: unknown,
  assets: readonly Asset[],
  options: PriceSnapshotValidationOptions = {},
): PriceSnapshotValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError(
          PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
          "input",
          "Price snapshot draft must be an object",
        ),
      ],
    };
  }

  const errors: PriceSnapshotValidationError[] = [];
  const assetSymbol = readAssetSymbol(input.assetSymbol, assets, errors);
  const price = readPositivePrice(input.price, errors);
  const currency = readRequiredString(input.currency, "currency", errors);
  const recordedAt = readRecordedAt(input.recordedAt, errors);
  const occurredTimeZone = readOptionalOccurredTimeZone(
    input.occurredTimeZone,
    errors,
  );
  const source = readSource(input.source, errors);
  const binanceProvenance = readBinanceProvenance(
    input.binanceProvenance,
    source,
    errors,
  );
  const note = readOptionalNote(input.note, errors);

  if (assetSymbol !== undefined && currency !== undefined) {
    const asset = assets.find((item) => item.symbol === assetSymbol);

    if (asset?.quoteCurrency !== currency) {
      errors.push(
        createError(
          PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
          "currency",
          `currency must match ${assetSymbol} quote currency`,
        ),
      );
    }
  }

  if (
    recordedAt !== undefined &&
    options.todayKey !== undefined &&
    isLedgerFactInFuture(recordedAt, options.todayKey)
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.FUTURE_FACT,
        "recordedAt",
        `recordedAt cannot be later than ${options.todayKey}`,
      ),
    );
  }

  if (
    options.requireSupportedValuationCurrency &&
    currency !== undefined &&
    !isSupportedValuationCurrency(currency)
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_VALUATION_CURRENCY,
        "currency",
        "V5 supports USDT valuation only",
      ),
    );
  }

  if (currency !== undefined && currency !== "USDT") {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
        "currency",
        "New price facts must use USDT",
      ),
    );
  }

  if (
    options.requireApiProvenance &&
    source === "api" &&
    binanceProvenance === undefined
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.BINANCE_PROVENANCE_REQUIRED,
        "binanceProvenance",
        "Binance API prices require provenance",
      ),
    );
  }

  if (
    errors.length > 0 ||
    assetSymbol === undefined ||
    price === undefined ||
    currency !== "USDT" ||
    recordedAt === undefined ||
    source === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      assetSymbol,
      price,
      currency,
      recordedAt,
      ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
      source,
      ...(binanceProvenance === undefined ? {} : { binanceProvenance }),
      ...(note === undefined ? {} : { note }),
    },
  };
}
