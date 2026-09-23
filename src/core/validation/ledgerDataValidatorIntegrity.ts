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
