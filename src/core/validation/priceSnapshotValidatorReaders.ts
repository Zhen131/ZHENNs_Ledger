/**
 * 这个文件管从一条价格的输入里逐个读出字段。
 * 读不对就记一条错。
 * 它不管整条能不能收，那在 priceSnapshotValidator.ts。
 * 没有特别的决定。
 */

import type { Asset, BinancePriceProvenance, PriceSource } from "@/core/models";
import { isPositive, isSupportedTimeZone } from "@/core/shared";
import { isValidISODateOrDateTime } from "./isoDateValidator";
import type {
  PriceSnapshotValidationField,
  PriceSnapshotValidationError,
} from "./priceSnapshotValidatorErrors";
import {
  PRICE_SNAPSHOT_VALIDATION_ERROR_CODES,
} from "./priceSnapshotValidatorErrors";

/**
 * 这个函数读出这条价格记在哪个地点；没填就算不知道。
 * 举例："Europe/Budapest" → 答它；"Mars/Base" → 答没有，并记一条错。
 */
export function readOptionalOccurredTimeZone(
  value: unknown,
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isSupportedTimeZone(value)) return value;
  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "occurredTimeZone",
      "occurredTimeZone must be a runtime-supported IANA time zone",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出行情价格的来历：哪个交易对、什么时候取的。
 * 只有来源是行情接口的价格才能带来历。
 * 举例：手动价格带了来历 → 答没有，记 `PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE`。
 * 来历缺交易对、报价币不是 USDT、取价时间不带时刻，都记错。
 */
export function readBinanceProvenance(
  value: unknown,
  source: PriceSource | undefined,
  errors: PriceSnapshotValidationError[],
): BinancePriceProvenance | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (source !== "api" || !isRecord(value)) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_BINANCE_PROVENANCE,
        "binanceProvenance",
        "binanceProvenance is only valid for api prices",
      ),
    );
    return undefined;
  }

  if (
    value.provider !== "binance" ||
    typeof value.symbol !== "string" ||
    value.symbol.length === 0 ||
    value.sourceQuoteCurrency !== "USDT" ||
    typeof value.fetchedAt !== "string" ||
    !value.fetchedAt.includes("T") ||
    !isValidISODateOrDateTime(value.fetchedAt)
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_BINANCE_PROVENANCE,
        "binanceProvenance",
        "binanceProvenance must contain provider, symbol, USDT quote and ISO fetchedAt",
      ),
    );
    return undefined;
  }

  return {
    provider: "binance",
    symbol: value.symbol,
    sourceQuoteCurrency: "USDT",
    fetchedAt: value.fetchedAt,
  };
}

/**
 * 这个函数回答：这个值是不是一个普通对象？
 * 数组和空值都不算。
 * 举例：{} → 答是；[] → 答不是。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 这个函数读出资产代码，账本里必须已经有这个资产。
 * 举例："BTC" → 答它；账本里没有 "SOL" 时答没有，记 `ASSET_NOT_FOUND` 那条。
 */
export function readAssetSymbol(
  value: unknown,
  assets: readonly Asset[],
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    assets.some((asset) => asset.symbol === value)
  ) {
    return value;
  }

  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.ASSET_NOT_FOUND,
      "assetSymbol",
      `Unknown asset: ${String(value)}`,
    ),
  );
  return undefined;
}

/**
 * 这个函数读出价格，必须是大于 0 的数字。
 * 举例："70000" → 答它；"0" → 答没有，记 `VALUE_MUST_BE_POSITIVE` 那条。
 */
export function readPositivePrice(
  value: unknown,
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
        "price",
        "price must be a valid finite decimal string",
      ),
    );
    return undefined;
  }

  try {
    if (!isPositive(value)) {
      errors.push(
        createError(
          PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.VALUE_MUST_BE_POSITIVE,
          "price",
          "price must be greater than 0",
        ),
      );
      return undefined;
    }
  } catch {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
        "price",
        "price must be a valid finite decimal string",
      ),
    );
    return undefined;
  }

  return value;
}

/**
 * 这个函数读出一个必填的文字（目前只有币种），不能是空的。
 * 举例："USDT" → 答它；"" → 答没有，并记一条错。
 */
export function readRequiredString(
  value: unknown,
  field: "currency",
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field,
      `${field} must be a non-empty string`,
    ),
  );
  return undefined;
}

/**
 * 这个函数读出价格记在哪天（或哪一刻），写法必须合法。
 * 举例："2026-08-20" → 答它；"20/08/2026" → 答没有，并记一条错。
 */
export function readRecordedAt(
  value: unknown,
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (isValidISODateOrDateTime(value)) {
    return value;
  }

  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "recordedAt",
      "recordedAt must be a valid ISO date or datetime string",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出价格的来源：手动填的，或行情接口取的。
 * 举例："manual" → 答它；"okx" → 答没有，记 `INVALID_SOURCE` 那条。
 */
export function readSource(
  value: unknown,
  errors: PriceSnapshotValidationError[],
): PriceSource | undefined {
  if (value === "manual" || value === "api") {
    return value;
  }

  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SOURCE,
      "source",
      "source must be manual or api",
    ),
  );
  return undefined;
}

/**
 * 这个函数读出备注，可以不填。
 * 举例：没填 → 答没有，也不记错；填了数字 5 → 答没有，记一条错。
 */
export function readOptionalNote(
  value: unknown,
  errors: PriceSnapshotValidationError[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  errors.push(
    createError(
      PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      "note",
      "note must be a string when provided",
    ),
  );
  return undefined;
}

/**
 * 这个函数把错误代码、格子、说明拼成一条价格检查错误。
 * 举例：传 `FUTURE_FACT` 那条代码、recordedAt、说明 → 答一条错误。
 */
export function createError(
  code: PriceSnapshotValidationError["code"],
  field: PriceSnapshotValidationField,
  message: string,
): PriceSnapshotValidationError {
  return { code, field, message };
}
