import type {
  Asset,
  PriceSnapshotDraft,
  PriceSource,
} from "../models";
import { isPositive } from "../utils/decimalMath";

export const PRICE_SNAPSHOT_VALIDATION_ERROR_CODES = {
  INVALID_INPUT: "PRICE_SNAPSHOT_INVALID_INPUT",
  ASSET_NOT_FOUND: "PRICE_SNAPSHOT_ASSET_NOT_FOUND",
  INVALID_DECIMAL: "PRICE_SNAPSHOT_INVALID_DECIMAL",
  VALUE_MUST_BE_POSITIVE: "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE",
  CURRENCY_MISMATCH: "PRICE_SNAPSHOT_CURRENCY_MISMATCH",
  INVALID_SOURCE: "PRICE_SNAPSHOT_INVALID_SOURCE",
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
    | "PRICE_SNAPSHOT_INVALID_SOURCE";
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

export function validatePriceSnapshotDraft(
  input: unknown,
  assets: readonly Asset[],
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
  const recordedAt = readRequiredString(
    input.recordedAt,
    "recordedAt",
    errors,
  );
  const source = readSource(input.source, errors);
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
      ...(note === undefined ? {} : { note }),
    },
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
  field: "currency" | "recordedAt",
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
