import {
  calculateCashEventUsdtDelta,
  calculateTradeUsdtCashDelta,
  compareCashReplayCandidates,
  replayPositions,
  replayUsdtCash,
  updatePositionForAppendedTrade,
} from "@/core/calculations";
import type {
  AssetTransfer,
  CashEvent,
  DecimalString,
  LedgerData,
  Position,
  PriceSnapshot,
  Trade,
  ValuationPriceMode,
} from "@/core/models";
import { isSupportedValuationCurrency } from "@/core/policies";
import {
  absolute,
  add,
  getLedgerDateKey,
  isNegative,
  isZero,
  multiply,
  subtract,
} from "@/core/shared";
import { getValuedPositionsFromLedger } from "./positionService";
import { selectPriceAsOf } from "./priceSelectionService";

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

export type AppendedLedgerFact =
  | Readonly<{ kind: "trade"; fact: Trade }>
  | Readonly<{ kind: "cash-event"; fact: CashEvent }>
  | Readonly<{ kind: "asset-transfer"; fact: AssetTransfer }>
  | Readonly<{ kind: "price-snapshot"; fact: PriceSnapshot }>;

export type IncrementalLedgerProjection = Readonly<{
  projection: LedgerProjection;
  cashReplay: "unchanged" | "appended" | "full-fallback";
  positionReplay: "unchanged" | "affected-asset" | "full-fallback";
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
  return createLedgerProjection(valuedPositions, cashReplay);
}

export function updateLedgerProjectionForAppendedFact(
  previous: LedgerProjection,
  ledgerData: LedgerData,
  appended: AppendedLedgerFact,
  options: Readonly<{
    asOf: string;
    mode: ValuationPriceMode;
  }>,
): IncrementalLedgerProjection {
  const cash = updateCashProjection(previous, ledgerData, appended, options.asOf);
  const positionUpdate = updateAffectedPosition(
    previous,
    ledgerData,
    appended,
    options,
  );
  if (positionUpdate === null) {
    return {
      projection: buildLedgerProjection(ledgerData, options),
      cashReplay: cash.mode,
      positionReplay: "full-fallback",
    };
  }
  return {
    projection: createLedgerProjection(positionUpdate.valuedPositions, cash.value),
    cashReplay: cash.mode,
    positionReplay: positionUpdate.mode,
  };
}

type ProjectionPriceSelection = Readonly<{
  actualSource: "manual" | "binance";
  asOf: string;
}>;

type ProjectionValuedPosition = Readonly<{
  position: Position;
  selectedPrice?: ProjectionPriceSelection;
}>;

function createLedgerProjection(
  valuedPositions: readonly ProjectionValuedPosition[],
  cashReplay: ReturnType<typeof replayUsdtCash>,
): LedgerProjection {
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

function updateCashProjection(
  previous: LedgerProjection,
  ledgerData: LedgerData,
  appended: AppendedLedgerFact,
  asOf: string,
): Readonly<{
  value: ReturnType<typeof replayUsdtCash>;
  mode: IncrementalLedgerProjection["cashReplay"];
}> {
  if (appended.kind !== "trade" && appended.kind !== "cash-event") {
    return {
      value: {
        balance: previous.cash.balance,
        effects: previous.cash.effects,
      },
      mode: "unchanged",
    };
  }
  if (getLedgerDateKey(appended.fact.occurredAt) > asOf) {
    return {
      value: {
        balance: previous.cash.balance,
        effects: previous.cash.effects,
      },
      mode: "unchanged",
    };
  }

  const candidate = {
    id: appended.fact.id,
    kind: appended.kind,
    occurredAt: appended.fact.occurredAt,
    createdAt: appended.fact.createdAt,
  } as const;
  const last = previous.cash.effects.at(-1);
  if (last && compareCashReplayCandidates(candidate, last) < 0) {
    return {
      value: replayUsdtCash(ledgerData, { asOf }),
      mode: "full-fallback",
    };
  }
  const delta =
    appended.kind === "trade"
      ? calculateTradeUsdtCashDelta(appended.fact)
      : calculateCashEventUsdtDelta(appended.fact);
  const balance = add(previous.cash.balance, delta);
  return {
    value: {
      balance,
      effects: [
        ...previous.cash.effects,
        { ...candidate, delta, balanceAfter: balance },
      ],
    },
    mode: "appended",
  };
}

function updateAffectedPosition(
  previous: LedgerProjection,
  ledgerData: LedgerData,
  appended: AppendedLedgerFact,
  options: Readonly<{ asOf: string; mode: ValuationPriceMode }>,
): Readonly<{
  valuedPositions: readonly ProjectionValuedPosition[];
  mode: IncrementalLedgerProjection["positionReplay"];
}> | null {
  const assetSymbol =
    appended.kind === "cash-event" ? undefined : appended.fact.assetSymbol;
  if (
    assetSymbol === undefined ||
    getLedgerDateKey(
      appended.kind === "price-snapshot"
        ? appended.fact.recordedAt
        : appended.fact.occurredAt,
    ) > options.asOf
  ) {
    return {
      valuedPositions: previousValuedPositions(previous),
      mode: "unchanged",
    };
  }

  const previousPosition = previous.positions.find(
    (position) => position.assetSymbol === assetSymbol,
  );
  if (!previousPosition && appended.kind !== "price-snapshot") {
    return null;
  }
  const replayedPosition =
    appended.kind === "price-snapshot"
      ? previousPosition
      : appended.kind === "trade" &&
          previousPosition &&
          isLatestPositionFact(ledgerData, appended.fact)
        ? updatePositionForAppendedTrade(previousPosition, appended.fact)
      : replayPositions(
          ledgerData.trades.filter(
            (trade) =>
              trade.assetSymbol === assetSymbol &&
              getLedgerDateKey(trade.occurredAt) <= options.asOf,
          ),
          ledgerData.assetTransfers.filter(
            (transfer) =>
              transfer.assetSymbol === assetSymbol &&
              getLedgerDateKey(transfer.occurredAt) <= options.asOf,
          ),
        )[0];
  if (!replayedPosition) {
    return {
      valuedPositions: previousValuedPositions(previous),
      mode: "unchanged",
    };
  }

  const valuedAffected = valuePosition(
    replayedPosition,
    ledgerData,
    options,
  );
  return {
    valuedPositions: previous.positions.map((position) =>
      position.assetSymbol === assetSymbol
        ? valuedAffected
        : previousValuedPosition(previous, position),
    ),
    mode:
      appended.kind === "price-snapshot" ? "unchanged" : "affected-asset",
  };
}

function isLatestPositionFact(
  ledgerData: LedgerData,
  appended: Trade,
): boolean {
  const candidate = {
    id: appended.id,
    kind: "trade" as const,
    occurredAt: appended.occurredAt,
    createdAt: appended.createdAt,
  };
  return (
    ledgerData.trades.every(
      (trade) =>
        trade.id === appended.id ||
        trade.assetSymbol !== appended.assetSymbol ||
        compareCashReplayCandidates(
          {
            id: trade.id,
            kind: "trade",
            occurredAt: trade.occurredAt,
            createdAt: trade.createdAt,
          },
          candidate,
        ) <= 0,
    ) &&
    ledgerData.assetTransfers.every(
      (transfer) =>
        transfer.assetSymbol !== appended.assetSymbol ||
        compareCashReplayCandidates(
          {
            id: transfer.id,
            kind: "asset-transfer",
            occurredAt: transfer.occurredAt,
            createdAt: transfer.createdAt,
          },
          candidate,
        ) <= 0,
    )
  );
}

function previousValuedPositions(
  previous: LedgerProjection,
): ProjectionValuedPosition[] {
  return previous.positions.map((position) =>
    previousValuedPosition(previous, position),
  );
}

function previousValuedPosition(
  previous: LedgerProjection,
  position: Position,
): ProjectionValuedPosition {
  const selection =
    previous.valuation.selectedPricesByAsset[position.assetSymbol];
  return {
    position,
    ...(selection
      ? {
          selectedPrice: {
            actualSource: selection.source,
            asOf: selection.asOf,
          },
        }
      : {}),
  };
}

function valuePosition(
  position: Position,
  ledgerData: LedgerData,
  options: Readonly<{ asOf: string; mode: ValuationPriceMode }>,
): ProjectionValuedPosition {
  const asset = ledgerData.assets.find(
    (candidate) => candidate.symbol === position.assetSymbol,
  );
  if (!asset) return { position };
  const selectedPrice = selectPriceAsOf(
    ledgerData.priceSnapshots,
    asset,
    options.asOf,
    options.mode,
  );
  if (!selectedPrice) return { position };
  const marketValue = multiply(position.quantity, selectedPrice.snapshot.price);
  return {
    selectedPrice,
    position: {
      ...position,
      latestPrice: selectedPrice.snapshot.price,
      marketValue,
      ...(position.feeAccountingIssues
        ? {}
        : { unrealizedPnl: subtract(marketValue, position.costBasis) }),
    },
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}
