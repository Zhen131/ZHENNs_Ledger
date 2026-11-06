/**
 * 这个文件管一件事：从账本算出首页要看的那一整份数。
 * 它自己不算现金和持仓，交给 core 的 `cashReplay`、`positionReplay` 和本区的 `positionService.ts`。
 * 不显然的决定：各页面共用这一份，不各写公式；2026-08-19 定（W14 01B 第 6.1 节）。
 */
import {
  calculateCashEventUsdtDelta,
  calculateTradeUsdtCashDelta,
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
  compareLedgerFactOrder,
  getLedgerDateKey,
  isNegative,
  isZero,
  multiply,
  subtract,
} from "@/core/shared";
import { translateDefault } from "@/ui";
import { getValuedPositionsFromLedger } from "./positionService";
import { selectPriceAsOf } from "./priceSelectionService";

/**
 * 算总资产时碰到的一个问题。
 * 要么某种币缺价格，要么它不是用 USDT 计价。
 * 带着给人看的说明文字。
 */
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

/**
 * 现金那一块：USDT 余额，和余额为负时缺多少。
 * 还有每笔记录让现金动了多少。
 */
export type LedgerCashProjection = Readonly<{
  currency: "USDT";
  balance: DecimalString;
  deficit: DecimalString;
  effects: ReturnType<typeof replayUsdtCash>["effects"];
}>;

/**
 * 总资产那一块：有价格的币值多少、加上现金一共多少。
 * 还说明算全了没有、缺了哪些币。
 * 每种币用的价格来自哪里，也记在里面。
 */
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

/** 首页要看的那一整份数：现金、持仓、总资产、问题清单。 */
export type LedgerProjection = Readonly<{
  cash: LedgerCashProjection;
  positions: readonly Position[];
  valuation: LedgerValuationProjection;
  issues: readonly LedgerProjectionIssue[];
}>;

/**
 * 刚加进账本的一笔记录。
 * 它是买卖、现金进出、转账、价格四种之一。
 */
export type AppendedLedgerFact =
  | Readonly<{ kind: "trade"; fact: Trade }>
  | Readonly<{ kind: "cash-event"; fact: CashEvent }>
  | Readonly<{ kind: "asset-transfer"; fact: AssetTransfer }>
  | Readonly<{ kind: "price-snapshot"; fact: PriceSnapshot }>;

/**
 * 只补算一笔新记录后的结果。
 * 另外说明现金和持仓各是怎么补算的。
 * 「full-fallback」表示那一块只好从头再算。
 */
export type IncrementalLedgerProjection = Readonly<{
  projection: LedgerProjection;
  cashReplay: "unchanged" | "appended" | "full-fallback";
  positionReplay: "unchanged" | "affected-asset" | "full-fallback";
}>;

/**
 * 这个函数回答：到某一天为止，现金、持仓、总资产各多少？
 * 总资产等于有价格的币的市值加上现金。
 * 现金可以是负数。
 * 举例：剩 0.06 BTC，价格 70000，现金 -200 USDT。
 * → 答总资产 4000，缺口 200。
 * 缺价格的币不按 0 算，而是列进问题清单，标成「没算全」。
 * 为什么不按 0 算：按 0 会冒充完整；2026-08-19 定（W14 01B 第 6.4 节）。
 * 不会出错。
 */
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

/**
 * 这个函数回答：只加了一笔新记录，能不能只补算这一笔？
 * 新记录排在已有记录后面，就只补这一笔。
 * 插到中间，或那种币原来没有持仓，就从头算。
 * 举例：上一份现金 1000，再加一笔最晚的入金 500。
 * → 答现金 1500，现金一块标「appended」。
 * 为什么要补算：账本大了每次从头算会卡；这是猜的，要核。
 * 不会出错；补不了就自动从头算。
 */
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
        message:
          position.assetSymbol +
          translateDefault("portfolio.issue.unsupportedCurrencyMiddle") +
          position.currency,
      });
      continue;
    }
    if (position.marketValue === undefined) {
      missingPriceAssets.push(position.assetSymbol);
      issues.push({
        code: "MISSING_CURRENT_PRICE",
        assetSymbol: position.assetSymbol,
        message:
          position.assetSymbol +
          translateDefault("portfolio.issue.missingCurrentPrice"),
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
  // 转账和价格不动现金，现金一块原样留着。
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
  if (last && compareLedgerFactOrder(candidate, last) < 0) {
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
  // 这种币原来没有持仓，补算会漏掉它，只好整份从头算。
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
        compareLedgerFactOrder(
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
        compareLedgerFactOrder(
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
    left < right ? -1 : left > right ? 1 : 0,
  );
}
