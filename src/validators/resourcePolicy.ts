import type { LedgerData } from "../models";

export const DEFAULT_LEDGER_RESOURCE_LIMITS = {
  fileBytes: 8 * 1024 * 1024,
  assets: 500,
  trades: 25_000,
  priceSnapshots: 5_000,
  feeRules: 500,
  id: 128,
  symbol: 32,
  currency: 32,
  name: 128,
  platform: 128,
  note: 4_096,
  rawText: 16_384,
} as const;

export type LedgerResourceLimits = typeof DEFAULT_LEDGER_RESOURCE_LIMITS;

export const LEDGER_RESOURCE_POLICY_ERROR_CODES = {
  FILE_TOO_LARGE: "LEDGER_RESOURCE_FILE_TOO_LARGE",
  COLLECTION_LIMIT_EXCEEDED: "LEDGER_RESOURCE_COLLECTION_LIMIT_EXCEEDED",
  STRING_LIMIT_EXCEEDED: "LEDGER_RESOURCE_STRING_LIMIT_EXCEEDED",
} as const;

export type LedgerResourcePolicyError = {
  code:
    | (typeof LEDGER_RESOURCE_POLICY_ERROR_CODES)[keyof typeof LEDGER_RESOURCE_POLICY_ERROR_CODES];
  path: string;
  limit: number;
  actual: number;
  message: string;
};

export type LedgerResourcePolicyResult =
  | { ok: true }
  | { ok: false; errors: LedgerResourcePolicyError[] };

/**
 * 独立于结构/业务 Validator 的资源保护层。
 *
 * 它不重写或拒绝既有可读取账本；调用方决定超限数据是只读恢复还是拒绝新写入。
 */
export function evaluateLedgerResourcePolicy(
  ledgerData: LedgerData,
  overrides: Partial<LedgerResourceLimits> = {},
): LedgerResourcePolicyResult {
  const limits = { ...DEFAULT_LEDGER_RESOURCE_LIMITS, ...overrides };
  const errors: LedgerResourcePolicyError[] = [];

  checkCollection(errors, "assets", ledgerData.assets.length, limits.assets);
  checkCollection(errors, "trades", ledgerData.trades.length, limits.trades);
  checkCollection(
    errors,
    "priceSnapshots",
    ledgerData.priceSnapshots.length,
    limits.priceSnapshots,
  );
  checkCollection(errors, "feeRules", ledgerData.feeRules.length, limits.feeRules);

  for (let index = 0; index < ledgerData.assets.length; index += 1) {
    const asset = ledgerData.assets[index];
    const path = `assets[${index}]`;
    checkString(errors, `${path}.id`, asset.id, limits.id);
    checkString(errors, `${path}.symbol`, asset.symbol, limits.symbol);
    checkString(errors, `${path}.name`, asset.name, limits.name);
    checkString(
      errors,
      `${path}.quoteCurrency`,
      asset.quoteCurrency,
      limits.currency,
    );
  }

  for (let index = 0; index < ledgerData.trades.length; index += 1) {
    const trade = ledgerData.trades[index];
    const path = `trades[${index}]`;
    checkString(errors, `${path}.id`, trade.id, limits.id);
    checkString(errors, `${path}.assetSymbol`, trade.assetSymbol, limits.symbol);
    checkString(errors, `${path}.currency`, trade.currency, limits.currency);
    checkString(errors, `${path}.feeCurrency`, trade.feeCurrency, limits.currency);
    checkOptionalString(errors, `${path}.feeRuleId`, trade.feeRuleId, limits.id);
    checkOptionalString(errors, `${path}.note`, trade.note, limits.note);
    checkOptionalString(errors, `${path}.rawText`, trade.rawText, limits.rawText);
  }

  for (
    let index = 0;
    index < ledgerData.priceSnapshots.length;
    index += 1
  ) {
    const priceSnapshot = ledgerData.priceSnapshots[index];
    const path = `priceSnapshots[${index}]`;
    checkString(errors, `${path}.id`, priceSnapshot.id, limits.id);
    checkString(
      errors,
      `${path}.assetSymbol`,
      priceSnapshot.assetSymbol,
      limits.symbol,
    );
    checkString(
      errors,
      `${path}.currency`,
      priceSnapshot.currency,
      limits.currency,
    );
    checkOptionalString(errors, `${path}.note`, priceSnapshot.note, limits.note);
  }

  for (let index = 0; index < ledgerData.feeRules.length; index += 1) {
    const feeRule = ledgerData.feeRules[index];
    const path = `feeRules[${index}]`;
    checkString(errors, `${path}.id`, feeRule.id, limits.id);
    checkString(errors, `${path}.name`, feeRule.name, limits.name);
    checkString(errors, `${path}.platform`, feeRule.platform, limits.platform);
    checkString(errors, `${path}.currency`, feeRule.currency, limits.currency);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * 给未来 JSON 导入入口使用：必须在 JSON.parse 之前调用。
 */
export function evaluateLedgerJsonResourcePolicy(
  serializedLedger: string,
  overrides: Partial<LedgerResourceLimits> = {},
): LedgerResourcePolicyResult {
  return evaluateLedgerByteLengthResourcePolicy(
    new TextEncoder().encode(serializedLedger).byteLength,
    overrides,
  );
}

/**
 * 供文件选择入口在读取 File.text() 前复用的字节上限检查。
 */
export function evaluateLedgerByteLengthResourcePolicy(
  byteLength: number,
  overrides: Partial<LedgerResourceLimits> = {},
): LedgerResourcePolicyResult {
  const limits = { ...DEFAULT_LEDGER_RESOURCE_LIMITS, ...overrides };

  if (byteLength <= limits.fileBytes) {
    return { ok: true };
  }

  return {
    ok: false,
    errors: [
      createError(
        LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE,
        "file",
        limits.fileBytes,
        byteLength,
      ),
    ],
  };
}

function checkCollection(
  errors: LedgerResourcePolicyError[],
  path: string,
  actual: number,
  limit: number,
) {
  if (actual > limit) {
    errors.push(
      createError(
        LEDGER_RESOURCE_POLICY_ERROR_CODES.COLLECTION_LIMIT_EXCEEDED,
        path,
        limit,
        actual,
      ),
    );
  }
}

function checkOptionalString(
  errors: LedgerResourcePolicyError[],
  path: string,
  value: string | undefined,
  limit: number,
) {
  if (value !== undefined) {
    checkString(errors, path, value, limit);
  }
}

function checkString(
  errors: LedgerResourcePolicyError[],
  path: string,
  value: string,
  limit: number,
) {
  if (value.length > limit) {
    errors.push(
      createError(
        LEDGER_RESOURCE_POLICY_ERROR_CODES.STRING_LIMIT_EXCEEDED,
        path,
        limit,
        value.length,
      ),
    );
  }
}

function createError(
  code: LedgerResourcePolicyError["code"],
  path: string,
  limit: number,
  actual: number,
): LedgerResourcePolicyError {
  const label =
    code === LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE
      ? "账本文件"
      : path;
  return {
    code,
    path,
    limit,
    actual,
    message: `${label} 超过资源上限（${actual} > ${limit}）`,
  };
}
