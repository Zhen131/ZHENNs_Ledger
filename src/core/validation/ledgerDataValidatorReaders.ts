/**
 * 这个文件管查整本账本时共用的小读取函数。
 * 读不对就记一条错。
 * 它不管某种记录有哪些字段。
 * 那在 ledgerDataValidatorAsset.ts 这类按记录分的文件里。
 * 不显然的决定：数字最多 40 位有效数字、18 位小数。
 * 超了就拒绝，不截断。2026-08-19 定（W14 01B 第 3.5 节）。
 */

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

/**
 * 这个函数读出一条记录，必须是一个对象。
 * 举例：传 "abc" → 答没有，记一条 `LEDGER_DATA_INVALID_ENTITY`。
 */
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

/**
 * 这个函数读出一个必填的文字，不能是空的。
 * 举例："BTC" → 答它；"" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出一个有长度上限的文字，前后也不能有空格。
 * 举例：上限 128，传 " id-1" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出一个编号，最多 128 个字，前后不能有空格。
 * 举例："trade-1" → 答它；129 个字 → 答没有，记一条错。
 * 为什么是 128：2026-08-19 定（W14 01B 第 3.5 节）。
 */
export function readTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return readBoundedString(value, path, 128, errors);
}

/**
 * 这个函数读出一个可以不填的编号，填了就按编号的规矩查。
 * 举例：没填 → 答没有，也不记错。
 */
export function readOptionalTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined ? undefined : readTechnicalId(value, path, errors);
}

/**
 * 这个函数读出一个要存进账本的文字。
 * 不能空，前后不能有空格。
 * 举例："Binance" → 答它；"Binance " → 答没有，记一条错。
 */
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

/**
 * 这个函数读出一个可以不填的文字。
 * 举例：没填 → 答没有，也不记错；填了数字 5 → 答没有，记一条错。
 */
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

/**
 * 这个函数读出一条记录的地点，必须是浏览器认识的地点名。
 * 举例："Asia/Shanghai" → 答它；"+08:00" → 答没有，记一条错。
 */
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
 * 这个函数回答：记录写的时差，和地点在那一刻的时差一样吗？
 * 只记到天的记录没有时差，不查；`Z` 和 `+00:00` 算同一个时差。
 * 举例：2026-01-10T09:00:00+02:00、Europe/Budapest → 答对不上，冬天应该是 +01:00。
 *
 * 为什么要查：时差和地点必须对得上。2026-09-07 定（W16 02A 修订 A 第九节 D-6）。
 * 对不上时不抛错，记一条错。
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

/**
 * 这个函数读出资产代码：大写字母和数字，不能是 USDT。
 * 举例："BTC" → 答它；"btc" 或 "USDT" → 答没有，记一条错。
 *
 * 为什么不能是 USDT：USDT 是现金，不当成普通资产。2026-08-19 定（W14 01B 第 4.1 节）。
 */
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

/**
 * 这个函数读出币种，只认 USDT。
 * 举例："USDT" → 答它；"USD" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出一笔记录发生在哪天或哪一刻。
 * 写法必须严格合法。
 * 举例："2026-08-20" → 答它；"2026-8-20" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出录入或修改时间：必须带时刻，也必须带时差。
 * 举例："2026-08-20T05:40:32Z" → 答它；"2026-08-20" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出可以不填的录入类时间。
 * 填了就按上面的规矩查。
 * 举例：没填 → 答没有，也不记错。
 */
export function readOptionalTechnicalTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readTechnicalTimestamp(value, path, errors);
}

/**
 * 这个函数回答：修改时间是不是不早于录入时间？
 * 举例：录入 8 月 20 日、修改 8 月 19 日 → 答不对，记一条错。
 * 为什么：2026-08-19 定（W14 01B 第 3.5 节）。
 */
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

/**
 * 这个函数读出这条记录记到多细：只到天、到分钟、到秒。
 * 举例："second" → 答它；"hour" → 答没有，记一条错。
 */
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

/**
 * 这个函数读出资产的小数位数，可以不填。
 * 填了必须是不小于 0 的整数。
 * 举例：8 → 答 8；-1 或 2.5 → 答没有，记一条错。
 */
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

/**
 * 这个函数读出可以不填的数字文字。
 * 填了就按数字的规矩查。
 * 举例：没填 → 答没有，也不记错。
 */
export function readOptionalCanonicalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readCanonicalDecimal(value, path, errors);
}

/**
 * 这个函数读出一个数字文字，按唯一写法查。
 * 还能要求它大于 0 或不小于 0。
 * 举例："6500" → 答它；"06500"、"-0"、"1e3" → 答没有，记一条错。
 * 举例：19 位小数 → 答没有，超了 18 位。
 *
 * 为什么最多 40 位有效数字、18 位小数：超了就拒绝，不截断。
 * 2026-08-19 定（W14 01B 第 3.5 节）。
 */
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

/**
 * 这个函数查一个对象的字段：不许多，也不许少。
 * 举例：映射少了 quoteAsset → 记「缺字段」；多了 note → 记「不认识的字段」。
 */
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

/**
 * 这个函数查一个对象有没有不认识的字段；少了不管。
 * 举例：交易多了 color 字段 → 记一条「不认识的字段」。
 *
 * 为什么不认识就拒绝：不能悄悄丢掉。2026-08-19 定（W14 01B 第 3.5 节）。
 */
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

/**
 * 这个函数回答：这个值是不是一个普通对象？数组和空值都不算。
 * 举例：{} → 答是；[] → 答不是。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 这个函数把错误代码、位置、说明拼成一条账本检查错误。
 * 举例：传 `LEDGER_DATA_INVALID_ENTITY`、"trades[0].fee"、说明 → 答一条错误。
 */
export function createError(
  code: LedgerDataValidationError["code"],
  path: string,
  message: string,
): LedgerDataValidationError {
  return { code, path, message };
}
