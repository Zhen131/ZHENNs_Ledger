import {
  isNegative,
  isPositive,
  getTimeZoneOffsetAt,
  isSupportedTimeZone,
} from "@/core/shared";
import { isValidISODateOrDateTime } from "./isoDateValidator";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  DECIMAL_PATTERN,
  ASSET_SYMBOL_PATTERN,
} from "./ledgerDataValidatorSchema";

export function readEntityRecord(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be an object`,
    ),
  );
  return undefined;
}

export function readRequiredString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a non-empty string`,
    ),
  );
  return undefined;
}

export function readBoundedString(
  value: unknown,
  path: string,
  limit: number,
  errors: LedgerDataValidationError[],
): string | undefined {
  const text = readRequiredString(value, path, errors);
  if (text === undefined) return undefined;
  if (text.trim() !== text || text.length > limit) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be trimmed and at most ${limit} characters`,
      ),
    );
    return undefined;
  }
  return text;
}

export function readTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return readBoundedString(value, path, 128, errors);
}

export function readOptionalTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined ? undefined : readTechnicalId(value, path, errors);
}

export function readPersistedString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  const text = readRequiredString(value, path, errors);
  if (text === undefined) return undefined;
  if (text.trim() === text) return text;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must not contain surrounding whitespace`,
    ),
  );
  return undefined;
}

export function readOptionalString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a string when provided`,
    ),
  );
  return undefined;
}

export function readOptionalOccurredTimeZone(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "string" && isSupportedTimeZone(value)) {
    return value;
  }

  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      "occurredTimeZone must be an IANA time zone recognized by the runtime",
    ),
  );
  return undefined;
}

/**
 * Rejects a fact whose recorded offset disagrees with the location it claims.
 * Date-only facts carry no offset and stay unconstrained; `Z` and `+00:00`
 * name the same offset and must not be told apart.
 */
export function validateOccurredTimeZoneOffset(
  timestamp: string | undefined,
  timeZone: string | undefined,
  path: string,
  errors: LedgerDataValidationError[],
): void {
  if (!timestamp || !timeZone || !/(Z|[+-]\d{2}:\d{2})$/.test(timestamp)) return;
  const actualOffset = getTimeZoneOffsetAt(new Date(timestamp), timeZone);
  const statedOffset = timestamp.endsWith("Z") ? "+00:00" : timestamp.slice(-6);
  if (actualOffset !== statedOffset) {
    errors.push(createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} offset must match occurredTimeZone at its instant`,
    ));
  }
}

export function readAssetSymbol(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    ASSET_SYMBOL_PATTERN.test(value) &&
    value !== "USDT"
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be an uppercase alphanumeric asset symbol other than USDT`,
    ),
  );
  return undefined;
}

export function readUsdt(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): "USDT" | undefined {
  if (value === "USDT") return "USDT";
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be USDT`,
    ),
  );
  return undefined;
}

export function readFactTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (isValidISODateOrDateTime(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a strict ISO date or datetime`,
    ),
  );
  return undefined;
}

export function readTechnicalTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    value.includes("T") &&
    isValidISODateOrDateTime(value)
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a strict ISO datetime with timezone`,
    ),
  );
  return undefined;
}

export function readOptionalTechnicalTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readTechnicalTimestamp(value, path, errors);
}

export function validateTimestampOrder(
  createdAt: string | undefined,
  updatedAt: string | undefined,
  path: string,
  errors: LedgerDataValidationError[],
): void {
  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        "updatedAt must not be earlier than createdAt",
      ),
    );
  }
}

export function readTimePrecision(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): "day" | "minute" | "second" | undefined {
  if (value === "day" || value === "minute" || value === "second") {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be day, minute, or second`,
    ),
  );
  return undefined;
}

export function readOptionalDecimals(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a non-negative integer when provided`,
    ),
  );
  return undefined;
}

export function readOptionalCanonicalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readCanonicalDecimal(value, path, errors);
}

export function readCanonicalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
  sign: "any" | "positive" | "non-negative" = "any",
): string | undefined {
  if (
    typeof value !== "string" ||
    !DECIMAL_PATTERN.test(value) ||
    /^-0(?:\.0+)?$/.test(value)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must use the canonical DecimalString grammar`,
      ),
    );
    return undefined;
  }
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const significantDigits =
    `${integer === "0" ? "" : integer}${fraction}`.replace(/^0+/, "")
      .length || 1;
  if (significantDigits > 40 || fraction.length > 18) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} exceeds 40 significant digits or 18 decimal places`,
      ),
    );
    return undefined;
  }
  if (sign === "positive" && !isPositive(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be greater than 0`,
      ),
    );
    return undefined;
  }
  if (sign === "non-negative" && isNegative(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be non-negative`,
      ),
    );
    return undefined;
  }
  return value;
}

export function checkExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
  errors: LedgerDataValidationError[],
): void {
  checkAllowedKeys(value, expectedKeys, path, errors);
  for (const key of expectedKeys) {
    if (!(key in value)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${key}`,
          `Missing field: ${key}`,
        ),
      );
    }
  }
}

export function checkAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: LedgerDataValidationError[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${key}`,
          `Unknown field: ${key}`,
        ),
      );
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createError(
  code: LedgerDataValidationError["code"],
  path: string,
  message: string,
): LedgerDataValidationError {
  return { code, path, message };
}
