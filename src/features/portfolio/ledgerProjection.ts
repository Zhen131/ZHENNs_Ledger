import { replayUsdtCash } from "@/core/calculations";
import type {
  DecimalString,
  LedgerData,
  Position,
  ValuationPriceMode,
} from "@/core/models";
import { isSupportedValuationCurrency } from "@/core/policies";
import { absolute, add, isNegative, isZero } from "@/core/shared";
import { getValuedPositionsFromLedger } from "./positionService";

export type LedgerProjectionIssue =
  | Readonly<{
      code: "MISSING_CURRENT_PRICE";
      assetSymbol: string;
      message: string;
    }>
  | Readonly<{
      code: "UNSUPPORTED_VALUATION_CURRENCY";
      assetSymbol: string;
      message: string;
    }>;

export type LedgerCashProjection = Readonly<{
  currency: "USDT";
  balance: DecimalString;
  deficit: DecimalString;
  effects: ReturnType<typeof replayUsdtCash>["effects"];
}>;

export type LedgerValuationProjection = Readonly<{
  currency: "USDT";
  pricedAssetMarketValue: DecimalString;
  totalAssetValue: DecimalString;
  complete: boolean;
  missingPriceAssets: readonly string[];
  excludedCurrencyAssets: readonly string[];
  selectedPricesByAsset: Readonly<
    Record<
      string,
      Readonly<{
        source: "manual" | "binance";
        asOf: string;
      }>
    >
  >;
}>;

export type LedgerProjection = Readonly<{
  cash: LedgerCashProjection;
  positions: readonly Position[];
  valuation: LedgerValuationProjection;
  issues: readonly LedgerProjectionIssue[];
}>;

export function buildLedgerProjection(
  ledgerData: LedgerData,
  options: Readonly<{
    asOf: string;
    mode: ValuationPriceMode;
  }>,
): LedgerProjection {
  const cashReplay = replayUsdtCash(ledgerData, { asOf: options.asOf });
  const valuedPositions = getValuedPositionsFromLedger(ledgerData, {
    todayKey: options.asOf,
    mode: options.mode,
  });
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];
  const issues: LedgerProjectionIssue[] = [];
  const selectedPricesByAsset: Record<
    string,
    { source: "manual" | "binance"; asOf: string }
  > = {};
  let pricedAssetMarketValue: DecimalString = "0";

  for (const { position, selectedPrice } of valuedPositions) {
    if (isZero(position.quantity)) continue;
    if (!isSupportedValuationCurrency(position.currency)) {
      excludedCurrencyAssets.push(position.assetSymbol);
      issues.push({
        code: "UNSUPPORTED_VALUATION_CURRENCY",
        assetSymbol: position.assetSymbol,
        message: `${position.assetSymbol} 使用不支持的计价币种 ${position.currency}`,
      });
      continue;
    }
    if (position.marketValue === undefined) {
      missingPriceAssets.push(position.assetSymbol);
      issues.push({
        code: "MISSING_CURRENT_PRICE",
        assetSymbol: position.assetSymbol,
        message: `${position.assetSymbol} 缺少合法当前价格`,
      });
      continue;
    }
    pricedAssetMarketValue = add(
      pricedAssetMarketValue,
      position.marketValue,
    );
    if (selectedPrice) {
      selectedPricesByAsset[position.assetSymbol] = {
        source: selectedPrice.actualSource,
        asOf: selectedPrice.asOf,
      };
    }
  }

  const missing = uniqueSorted(missingPriceAssets);
  const excluded = uniqueSorted(excludedCurrencyAssets);
  return {
    cash: {
      currency: "USDT",
      balance: cashReplay.balance,
      deficit: isNegative(cashReplay.balance)
        ? absolute(cashReplay.balance)
        : "0",
      effects: cashReplay.effects,
    },
    positions: valuedPositions.map(({ position }) => position),
    valuation: {
      currency: "USDT",
      pricedAssetMarketValue,
      totalAssetValue: add(pricedAssetMarketValue, cashReplay.balance),
      complete: missing.length === 0 && excluded.length === 0,
      missingPriceAssets: missing,
      excludedCurrencyAssets: excluded,
      selectedPricesByAsset,
    },
    issues,
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}
