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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function createError(
  code: PriceSnapshotValidationError["code"],
  field: PriceSnapshotValidationField,
  message: string,
): PriceSnapshotValidationError {
  return { code, field, message };
}
