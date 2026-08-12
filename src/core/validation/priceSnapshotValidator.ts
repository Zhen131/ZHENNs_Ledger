import type {
  Asset,
  BinancePriceProvenance,
  PriceSnapshotDraft,
  PriceSource,
} from "@/core/models";
import { isPositive } from "@/core/shared";
import { isLedgerFactInFuture } from "@/core/shared";
import { isSupportedValuationCurrency } from "@/core/policies";
import { isValidISODateOrDateTime } from "./isoDateValidator";

export const PRICE_SNAPSHOT_VALIDATION_ERROR_CODES = {
  INVALID_INPUT: "PRICE_SNAPSHOT_INVALID_INPUT",
  ASSET_NOT_FOUND: "PRICE_SNAPSHOT_ASSET_NOT_FOUND",
  INVALID_DECIMAL: "PRICE_SNAPSHOT_INVALID_DECIMAL",
  VALUE_MUST_BE_POSITIVE: "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE",
  CURRENCY_MISMATCH: "PRICE_SNAPSHOT_CURRENCY_MISMATCH",
  INVALID_SOURCE: "PRICE_SNAPSHOT_INVALID_SOURCE",
  INVALID_BINANCE_PROVENANCE: "PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE",
  FUTURE_FACT: "PRICE_SNAPSHOT_FUTURE_FACT",
  UNSUPPORTED_VALUATION_CURRENCY:
    "PRICE_SNAPSHOT_UNSUPPORTED_VALUATION_CURRENCY",
  BINANCE_PROVENANCE_REQUIRED:
    "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED",
  NEW_FACT_REQUIRES_USDT: "PRICE_SNAPSHOT_NEW_FACT_REQUIRES_USDT",
} as const;

export type PriceSnapshotValidationField =
  | "input"
  | keyof PriceSnapshotDraft;

export type PriceSnapshotValidationError = {
  code:
    | "PRICE_SNAPSHOT_INVALID_INPUT"
    | "PRICE_SNAPSHOT_ASSET_NOT_FOUND"
    | "PRICE_SNAPSHOT_INVALID_DECIMAL"
    | "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE"
    | "PRICE_SNAPSHOT_CURRENCY_MISMATCH"
    | "PRICE_SNAPSHOT_INVALID_SOURCE"
    | "PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE"
    | "PRICE_SNAPSHOT_FUTURE_FACT"
    | "PRICE_SNAPSHOT_UNSUPPORTED_VALUATION_CURRENCY"
    | "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED"
    | "PRICE_SNAPSHOT_NEW_FACT_REQUIRES_USDT";
  field: PriceSnapshotValidationField;
  message: string;
};

export type PriceSnapshotValidationResult =
  | {
      ok: true;
      value: PriceSnapshotDraft;
    }
  | {
      ok: false;
      errors: PriceSnapshotValidationError[];
    };

export type PriceSnapshotValidationOptions = {
  todayKey?: string;
  requireSupportedValuationCurrency?: boolean;
  requireApiProvenance?: boolean;
  requiredCurrency?: string;
};

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
        "Only USD/USDT valuation is supported",
      ),
    );
  }

  if (
    options.requiredCurrency !== undefined &&
    currency !== undefined &&
    currency !== options.requiredCurrency
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
        "currency",
        `New price facts must use ${options.requiredCurrency}`,
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
    currency === undefined ||
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
      source,
      ...(binanceProvenance === undefined ? {} : { binanceProvenance }),
      ...(note === undefined ? {} : { note }),
    },
  };
}

function readBinanceProvenance(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAssetSymbol(
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

function readPositivePrice(
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

function readRequiredString(
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

function readRecordedAt(
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

function readSource(
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

function readOptionalNote(
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

function createError(
  code: PriceSnapshotValidationError["code"],
  field: PriceSnapshotValidationField,
  message: string,
): PriceSnapshotValidationError {
  return { code, field, message };
}
