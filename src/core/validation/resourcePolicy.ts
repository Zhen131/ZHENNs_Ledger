/**
 * 这个文件管账本的大小上限。
 * 它量文件多大、每种记录多少条、每个文字多长。
 * 它不管内容对不对，那在 ledgerDataValidator.ts。
 * 不显然的决定：超了上限也不改写旧账本。
 * 由调用方决定只读还是拒绝新写入。这是猜的，日志里没写，要核。
 */

import type { LedgerData, Trade } from "@/core/models";
import { translateDefault } from "@/ui";

/**
 * 账本的默认上限。文件 128 MiB，买卖、现金、转移各 25 万条。
 * 价格 5 万条，资产和手续费规则各 500 条。
 * 文字长度：编号 128、代码和币种 32、备注 4096、原文 16384。
 * 为什么是这些数：这是猜的，日志里没写，要核。
 */
export const DEFAULT_LEDGER_RESOURCE_LIMITS = {
  fileBytes: 128 * 1024 * 1024,
  assets: 500,
  trades: 250_000,
  cashEvents: 250_000,
  assetTransfers: 250_000,
  priceSnapshots: 50_000,
  feeRules: 500,
  id: 128,
  symbol: 32,
  currency: 32,
  name: 128,
  platform: 128,
  decimal: 256,
  note: 4_096,
  rawText: 16_384,
} as const;

type LedgerResourceLimits = {
  [Key in keyof typeof DEFAULT_LEDGER_RESOURCE_LIMITS]: number;
};

/** 超上限时的三种错误代码：文件太大、条数太多、文字太长。 */
export const LEDGER_RESOURCE_POLICY_ERROR_CODES = {
  FILE_TOO_LARGE: "LEDGER_RESOURCE_FILE_TOO_LARGE",
  COLLECTION_LIMIT_EXCEEDED: "LEDGER_RESOURCE_COLLECTION_LIMIT_EXCEEDED",
  STRING_LIMIT_EXCEEDED: "LEDGER_RESOURCE_STRING_LIMIT_EXCEEDED",
} as const;

/**
 * 一条超上限错误。
 * 记的是哪里超了、上限多少、实际多少、给人看的说明。
 */
export type LedgerResourcePolicyError = {
  code:
    | (typeof LEDGER_RESOURCE_POLICY_ERROR_CODES)[keyof typeof LEDGER_RESOURCE_POLICY_ERROR_CODES];
  path: string;
  limit: number;
  actual: number;
  message: string;
};

type LedgerResourcePolicyResult =
  | { ok: true }
  | { ok: false; errors: LedgerResourcePolicyError[] };

/**
 * 这个函数回答：这本账本有没有哪样超过上限？
 * 它查每种记录的条数和每个文字的长度。
 * 举例：买卖 250001 笔 → 答超了，`LEDGER_RESOURCE_COLLECTION_LIMIT_EXCEEDED`。
 *
 * 为什么单独一层：它只量大小，不管内容对不对，也不改旧账本。
 * 调用方决定超了是只读打开还是拒绝新写入。（这是猜的，日志里没写，要核。）
 * 不抛错，返回 ok:false 和全部超限项。
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
    "cashEvents",
    ledgerData.cashEvents.length,
    limits.cashEvents,
  );
  checkCollection(
    errors,
    "assetTransfers",
    ledgerData.assetTransfers.length,
    limits.assetTransfers,
  );
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
    if (asset.binanceMapping) {
      checkString(
        errors,
        `${path}.binanceMapping.symbol`,
        asset.binanceMapping.symbol,
        limits.symbol,
      );
      checkString(
        errors,
        `${path}.binanceMapping.baseAsset`,
        asset.binanceMapping.baseAsset,
        limits.symbol,
      );
      checkString(
        errors,
        `${path}.binanceMapping.quoteAsset`,
        asset.binanceMapping.quoteAsset,
        limits.currency,
      );
    }
  }

  for (let index = 0; index < ledgerData.trades.length; index += 1) {
    const trade = ledgerData.trades[index];
    const path = `trades[${index}]`;
    checkString(errors, `${path}.id`, trade.id, limits.id);
    checkString(errors, `${path}.assetSymbol`, trade.assetSymbol, limits.symbol);
    checkString(errors, `${path}.currency`, trade.currency, limits.currency);
    checkString(errors, `${path}.feeCurrency`, trade.feeCurrency, limits.currency);
    checkString(errors, `${path}.quantity`, trade.quantity, limits.decimal);
    checkString(errors, `${path}.price`, trade.price, limits.decimal);
    checkString(errors, `${path}.totalValue`, trade.totalValue, limits.decimal);
    checkString(errors, `${path}.fee`, trade.fee, limits.decimal);
    checkOptionalString(
      errors,
      `${path}.quantitySortKey`,
      trade.quantitySortKey,
      limits.decimal,
    );
    checkOptionalString(
      errors,
      `${path}.totalValueSortKey`,
      trade.totalValueSortKey,
      limits.decimal,
    );
    checkOptionalString(errors, `${path}.platform`, trade.platform, limits.platform);
    checkOptionalString(errors, `${path}.feeRuleId`, trade.feeRuleId, limits.id);
    checkOptionalString(errors, `${path}.note`, trade.note, limits.note);
    checkOptionalString(errors, `${path}.rawText`, trade.rawText, limits.rawText);
  }

  for (let index = 0; index < ledgerData.cashEvents.length; index += 1) {
    const cashEvent = ledgerData.cashEvents[index];
    const path = `cashEvents[${index}]`;
    checkString(errors, `${path}.id`, cashEvent.id, limits.id);
    checkString(errors, `${path}.currency`, cashEvent.currency, limits.currency);
    checkOptionalString(errors, `${path}.note`, cashEvent.note, limits.note);
    if (cashEvent.type === "balance-adjustment") {
      checkString(
        errors,
        `${path}.balanceBefore`,
        cashEvent.balanceBefore,
        limits.decimal,
      );
      checkString(
        errors,
        `${path}.targetBalance`,
        cashEvent.targetBalance,
        limits.decimal,
      );
      checkString(
        errors,
        `${path}.adjustmentAmount`,
        cashEvent.adjustmentAmount,
        limits.decimal,
      );
    } else {
      checkString(errors, `${path}.amount`, cashEvent.amount, limits.decimal);
    }
  }

  for (let index = 0; index < ledgerData.assetTransfers.length; index += 1) {
    const assetTransfer = ledgerData.assetTransfers[index];
    const path = `assetTransfers[${index}]`;
    checkString(errors, `${path}.id`, assetTransfer.id, limits.id);
    checkString(
      errors,
      `${path}.assetSymbol`,
      assetTransfer.assetSymbol,
      limits.symbol,
    );
    checkString(
      errors,
      `${path}.quantity`,
      assetTransfer.quantity,
      limits.decimal,
    );
    checkOptionalString(
      errors,
      `${path}.unitPrice`,
      assetTransfer.unitPrice,
      limits.decimal,
    );
    checkOptionalString(
      errors,
      `${path}.networkFee`,
      assetTransfer.networkFee,
      limits.decimal,
    );
    checkOptionalString(
      errors,
      `${path}.note`,
      assetTransfer.note,
      limits.note,
    );
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
    checkString(errors, `${path}.price`, priceSnapshot.price, limits.decimal);
    checkOptionalString(errors, `${path}.note`, priceSnapshot.note, limits.note);
    if (priceSnapshot.binanceProvenance) {
      checkString(
        errors,
        `${path}.binanceProvenance.symbol`,
        priceSnapshot.binanceProvenance.symbol,
        limits.symbol,
      );
      checkString(
        errors,
        `${path}.binanceProvenance.sourceQuoteCurrency`,
        priceSnapshot.binanceProvenance.sourceQuoteCurrency,
        limits.currency,
      );
    }
  }

  for (let index = 0; index < ledgerData.feeRules.length; index += 1) {
    const feeRule = ledgerData.feeRules[index];
    const path = `feeRules[${index}]`;
    checkString(errors, `${path}.id`, feeRule.id, limits.id);
    checkString(errors, `${path}.name`, feeRule.name, limits.name);
    checkString(errors, `${path}.platform`, feeRule.platform, limits.platform);
    checkString(
      errors,
      `${path}.assetSymbol`,
      feeRule.assetSymbol,
      limits.symbol,
    );
    checkString(errors, `${path}.currency`, feeRule.currency, limits.currency);
    checkString(
      errors,
      `${path}.${feeRule.type === "fixed" ? "amount" : "rate"}`,
      feeRule.type === "fixed" ? feeRule.amount : feeRule.rate,
      limits.decimal,
    );
    checkOptionalString(
      errors,
      `${path}.replacesFeeRuleId`,
      feeRule.replacesFeeRuleId,
      limits.id,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * 这个函数回答：刚接上一笔买卖后，有没有哪样超过上限？
 * 只查各种条数和新这一笔的文字，不重查旧记录。
 * 举例：备注 5000 个字 → 答超了，上限 4096。
 * 不抛错，返回 ok:false 和全部超限项。
 */
export function evaluateLedgerResourcePolicyAfterTradeAppend(
  ledgerData: LedgerData,
  trade: Trade,
  overrides: Partial<LedgerResourceLimits> = {},
): LedgerResourcePolicyResult {
  const limits = { ...DEFAULT_LEDGER_RESOURCE_LIMITS, ...overrides };
  const errors: LedgerResourcePolicyError[] = [];

  checkCollection(errors, "assets", ledgerData.assets.length, limits.assets);
  checkCollection(errors, "trades", ledgerData.trades.length, limits.trades);
  checkCollection(
    errors,
    "cashEvents",
    ledgerData.cashEvents.length,
    limits.cashEvents,
  );
  checkCollection(
    errors,
    "assetTransfers",
    ledgerData.assetTransfers.length,
    limits.assetTransfers,
  );
  checkCollection(
    errors,
    "priceSnapshots",
    ledgerData.priceSnapshots.length,
    limits.priceSnapshots,
  );
  checkCollection(
    errors,
    "feeRules",
    ledgerData.feeRules.length,
    limits.feeRules,
  );

  const path = `trades[${ledgerData.trades.length - 1}]`;
  checkString(errors, `${path}.id`, trade.id, limits.id);
  checkString(errors, `${path}.assetSymbol`, trade.assetSymbol, limits.symbol);
  checkString(errors, `${path}.currency`, trade.currency, limits.currency);
  checkString(errors, `${path}.feeCurrency`, trade.feeCurrency, limits.currency);
  checkString(errors, `${path}.quantity`, trade.quantity, limits.decimal);
  checkString(errors, `${path}.price`, trade.price, limits.decimal);
  checkString(errors, `${path}.totalValue`, trade.totalValue, limits.decimal);
  checkString(errors, `${path}.fee`, trade.fee, limits.decimal);
  checkOptionalString(
    errors,
    `${path}.quantitySortKey`,
    trade.quantitySortKey,
    limits.decimal,
  );
  checkOptionalString(
    errors,
    `${path}.totalValueSortKey`,
    trade.totalValueSortKey,
    limits.decimal,
  );
  checkOptionalString(errors, `${path}.platform`, trade.platform, limits.platform);
  checkOptionalString(errors, `${path}.feeRuleId`, trade.feeRuleId, limits.id);
  checkOptionalString(errors, `${path}.note`, trade.note, limits.note);
  checkOptionalString(errors, `${path}.rawText`, trade.rawText, limits.rawText);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * 这个函数回答：一段账本文字按字节算，有没有超过文件上限？
 * 要在把文字读成对象之前调用，免得先吃掉大量内存。
 * 举例：130 MiB 的文字 → 答超了，上限 128 MiB。
 * 不抛错，返回 ok:false。
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
 * 这个函数回答：一个文件的字节数有没有超过上限？
 * 选文件时先问它，再去读文件内容。
 * 举例：上限 128 MiB，文件 129 MiB → 答超了，`LEDGER_RESOURCE_FILE_TOO_LARGE`。
 * 不抛错，返回 ok:false。
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
      ? translateDefault("policy.resource.ledgerFileLabel")
      : path;
  return {
    code,
    path,
    limit,
    actual,
    message: `${label}${translateDefault("policy.resource.overLimitMiddle")}${actual} > ${limit}${translateDefault("policy.resource.overLimitSuffix")}`,
  };
}
