/**
 * 这个文件管查整本账本时，记录之间的关系对不对。
 * 查三样：编号不重复、引用存在、替换不成环。
 * 它不管单条记录的字段，那在 ledgerDataValidatorAsset.ts 这类按记录分的文件里。
 * 不显然的决定：各种记录共用一套编号，跨种类也不许重复。2026-08-19 定（W14 01B 第 3.5 节）。
 */

import type {
  Asset,
  AssetTransfer,
  FeeRule,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import { isZero } from "@/core/shared";
import { createError } from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
} from "./ledgerDataValidatorSchema";

/**
 * 这个函数回答：全本账本里有没有两条记录用了同一个编号？
 * 举例：一笔买卖和一条价格都叫 "id-1" → 答有，第二个记一条错。
 * 不抛错，错误放进传进来的列表。
 */
export function validateGlobalIdentifiers(
  collections: Pick<
    LedgerData,
    | "assets"
    | "trades"
    | "cashEvents"
    | "assetTransfers"
    | "priceSnapshots"
    | "feeRules"
  >,
  errors: LedgerDataValidationError[],
): void {
  const firstPathById = new Map<string, string>();
  for (const [collection, entities] of Object.entries(collections)) {
    entities.forEach(({ id }, index) => {
      const path = `${collection}[${index}].id`;
      const firstPath = firstPathById.get(id);
      if (firstPath !== undefined) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
            path,
            `Duplicate id ${id}; first used at ${firstPath}`,
          ),
        );
      } else {
        firstPathById.set(id, path);
      }
    });
  }
}

/**
 * 这个函数回答：有没有两个资产用了同一个代码？
 * 举例：两个资产都叫 BTC → 答有，第二个记一条错。
 * 不抛错，错误放进传进来的列表。
 */
export function validateUniqueAssetSymbols(
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): void {
  const firstIndexBySymbol = new Map<string, number>();
  assets.forEach((asset, index) => {
    const firstIndex = firstIndexBySymbol.get(asset.symbol);
    if (firstIndex !== undefined) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_ASSET_SYMBOL,
          `assets[${index}].symbol`,
          `Duplicate asset symbol ${asset.symbol}; first used at assets[${firstIndex}]`,
        ),
      );
    } else {
      firstIndexBySymbol.set(asset.symbol, index);
    }
  });
}

/**
 * 这个函数回答：每条记录提到的资产和规则，账本里都有吗？
 * 买卖、转移、价格、规则都要指向已有的资产。
 * 非零手续费用的不是 USDT 时，那个币也必须是已有的资产。
 * 买卖用了某条规则，规则的平台和资产要和这笔一样。
 * 替换的旧规则必须已停用、同平台同资产。
 * 替换链不许绕成圈。
 * 举例：规则 A 替换 B、B 又替换 A → 答成圈，记一条错。
 *
 * 为什么规则要这样查：2026-08-10 定（W12 02A 第 5.1 节）。
 * 不抛错，错误放进传进来的列表。
 */
export function validateReferences(
  trades: readonly Trade[],
  assetTransfers: readonly AssetTransfer[],
  priceSnapshots: readonly PriceSnapshot[],
  feeRules: readonly FeeRule[],
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): void {
  const assetSymbols = new Set(assets.map(({ symbol }) => symbol));
  const feeRulesById = new Map(feeRules.map((rule) => [rule.id, rule]));
  priceSnapshots.forEach((snapshot, index) => {
    if (!assetSymbols.has(snapshot.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `priceSnapshots[${index}].assetSymbol`,
          `Unknown asset: ${snapshot.assetSymbol}`,
        ),
      );
    }
  });
  assetTransfers.forEach((assetTransfer, index) => {
    if (!assetSymbols.has(assetTransfer.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `assetTransfers[${index}].assetSymbol`,
          `Unknown asset: ${assetTransfer.assetSymbol}`,
        ),
      );
    }
  });
  trades.forEach((trade, index) => {
    if (!assetSymbols.has(trade.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `trades[${index}].assetSymbol`,
          `Unknown asset: ${trade.assetSymbol}`,
        ),
      );
    }
    if (
      !isZero(trade.fee) &&
      trade.feeCurrency !== "USDT" &&
      !assetSymbols.has(trade.feeCurrency)
    ) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `trades[${index}].feeCurrency`,
          `Unknown fee asset: ${trade.feeCurrency}`,
        ),
      );
    }
    if (trade.feeRuleId !== undefined) {
      const rule = feeRulesById.get(trade.feeRuleId);
      if (!rule) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `trades[${index}].feeRuleId`,
            `Unknown fee rule: ${trade.feeRuleId}`,
          ),
        );
      } else if (
        rule.assetSymbol !== trade.assetSymbol ||
        rule.platform !== trade.platform
      ) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `trades[${index}].feeRuleId`,
            "Fee rule must match the trade platform and asset",
          ),
        );
      }
    }
  });
  feeRules.forEach((feeRule, index) => {
    const path = `feeRules[${index}]`;
    if (!assetSymbols.has(feeRule.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.assetSymbol`,
          `Unknown asset: ${feeRule.assetSymbol}`,
        ),
      );
    }
    if (feeRule.replacesFeeRuleId === undefined) return;
    const replaced = feeRulesById.get(feeRule.replacesFeeRuleId);
    if (!replaced) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.replacesFeeRuleId`,
          `Unknown replaced fee rule: ${feeRule.replacesFeeRuleId}`,
        ),
      );
    } else if (
      replaced.id === feeRule.id ||
      replaced.status !== "inactive" ||
      replaced.platform !== feeRule.platform ||
      replaced.assetSymbol !== feeRule.assetSymbol
    ) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.replacesFeeRuleId`,
          "A replacement must reference a different inactive rule with the same platform and asset",
        ),
      );
    }
  });
  feeRules.forEach((feeRule, index) => {
    const visited = new Set<string>();
    let current: FeeRule | undefined = feeRule;
    while (current?.replacesFeeRuleId !== undefined) {
      if (visited.has(current.id)) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `feeRules[${index}].replacesFeeRuleId`,
            "Fee rule replacement links must not form a cycle",
          ),
        );
        break;
      }
      visited.add(current.id);
      current = feeRulesById.get(current.replacesFeeRuleId);
    }
  });
}
