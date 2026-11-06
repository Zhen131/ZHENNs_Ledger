/**
 * 这个文件管一件事：算出持仓分配图上每一块多大。
 * 它不自己算市值和现金，交给 portfolio 的 `buildLedgerProjection`。
 * 不显然的决定：现金为负时不画成一块，只另写缺口；2026-08-19 定（W14 01B 第 6.4 节）。
 */
import type {
  DecimalString,
  LedgerData,
  ValuationPriceMode,
} from "@/core/models";
import {
  add,
  divide,
  isGreaterThan,
  isLessThan,
  isNegative,
  isPositive,
  isZero,
  toDecimalString,
} from "@/core/shared";
import {
  buildLedgerProjection,
  createValuationDisplay,
  type LedgerProjection,
} from "@/features/portfolio";
import { translateDefault } from "@/ui";
import type {
  HoldingAllocationSlice,
  HoldingAllocation,
} from "./chartDataService";
import { getDefaultValuationCurrency } from "./chartDataServiceShared";

/**
 * 占比不到 2% 的币并进「其他」。
 * 为什么是 2%：日志里没写，这是猜的，要核。
 */
const MIN_STANDALONE_ALLOCATION_RATIO = "0.02";
/**
 * 分配图最多 8 块，超了把小的并进「其他」。
 * 为什么是 8：日志里没写，这是猜的，要核。
 */
const MAX_ALLOCATION_SLICES = 8;
const MAX_VISIBLE_SLICES_WITH_GROUP = MAX_ALLOCATION_SLICES - 1;

/**
 * 这个函数回答：持仓分配图上每一块占多少？
 * 现金为正时也算一块，分母是币的市值加现金。
 * 现金为负时不画，分母只用币的市值，缺口另外写。
 * 举例：BTC 4200、ETH 3000、现金 800 → 答 BTC 52.5%、ETH 37.5%、现金 10%。
 * 不到 2% 的并进「其他」，总共最多 8 块。
 * 分母为 0 时返回没有块，不造一个 100%。
 * 传了 `projection` 就直接用，省得再算一遍。
 * 不会出错。
 */
export function buildHoldingAllocation(
  ledgerData: LedgerData,
  options: {
    todayKey: string;
    mode: ValuationPriceMode;
    projection?: LedgerProjection;
  },
): HoldingAllocation {
  const projection =
    options.projection ??
    buildLedgerProjection(ledgerData, {
      asOf: options.todayKey,
      mode: options.mode,
    });
  const valued: Array<{
    assetSymbol: string;
    marketValue: DecimalString;
    source: "manual" | "binance" | "cash";
    asOf: string;
  }> = [];
  for (const position of projection.positions) {
    if (isZero(position.quantity) || position.marketValue === undefined) continue;
    const selected =
      projection.valuation.selectedPricesByAsset[position.assetSymbol];
    if (!selected) continue;
    valued.push({
      assetSymbol: position.assetSymbol,
      marketValue: position.marketValue,
      source: selected.source,
      asOf: selected.asOf,
    });
  }

  const cashBalance = projection.cash.balance;
  const geometryTotal = isNegative(cashBalance)
    ? projection.valuation.pricedAssetMarketValue
    : add(projection.valuation.pricedAssetMarketValue, cashBalance);
  if (!isNegative(cashBalance) && !isZero(cashBalance)) {
    valued.push({
      assetSymbol: translateDefault("charts.series.cashUsdt"),
      marketValue: cashBalance,
      source: "cash",
      asOf: options.todayKey,
    });
  }

  const sortedPositiveValues = valued
    .filter((item) => isPositive(item.marketValue))
    .sort(compareAllocationMarketValue);
  const slices = isZero(geometryTotal)
    ? []
    : groupHoldingAllocationSlices(
        sortedPositiveValues.map<HoldingAllocationSlice>((item) => ({
          ...item,
          ratio: toDecimalString(divide(item.marketValue, geometryTotal)),
        })),
        geometryTotal,
        options.todayKey,
      );

  return {
    slices,
    assetMarketValue: projection.valuation.pricedAssetMarketValue,
    cashBalance,
    cashDeficit: projection.cash.deficit,
    totalMarketValue: projection.valuation.totalAssetValue,
    missingPriceAssets: [...projection.valuation.missingPriceAssets],
    excludedCurrencyAssets: [
      ...projection.valuation.excludedCurrencyAssets,
    ],
    valuation: createValuationDisplay(
      ["USDT"],
      getDefaultValuationCurrency(ledgerData),
    ),
  };
}

function compareAllocationMarketValue(
  left: Pick<HoldingAllocationSlice, "assetSymbol" | "marketValue">,
  right: Pick<HoldingAllocationSlice, "assetSymbol" | "marketValue">,
): number {
  if (isGreaterThan(left.marketValue, right.marketValue)) return -1;
  if (isGreaterThan(right.marketValue, left.marketValue)) return 1;
  return left.assetSymbol < right.assetSymbol
    ? -1
    : left.assetSymbol > right.assetSymbol
      ? 1
      : 0;
}

function groupHoldingAllocationSlices(
  sortedSlices: readonly HoldingAllocationSlice[],
  geometryTotal: DecimalString,
  todayKey: string,
): HoldingAllocationSlice[] {
  const standalone = sortedSlices.filter(
    (slice) => !isLessThan(slice.ratio, MIN_STANDALONE_ALLOCATION_RATIO),
  );
  const belowThreshold = sortedSlices.filter((slice) =>
    isLessThan(slice.ratio, MIN_STANDALONE_ALLOCATION_RATIO),
  );

  if (belowThreshold.length === 0 && standalone.length <= MAX_ALLOCATION_SLICES) {
    return standalone;
  }
  if (
    belowThreshold.length > 0 &&
    standalone.length + 1 <= MAX_ALLOCATION_SLICES
  ) {
    return [
      ...standalone,
      createGroupedAllocationSlice(belowThreshold, geometryTotal, todayKey),
    ];
  }

  const visible = sortedSlices.slice(0, MAX_VISIBLE_SLICES_WITH_GROUP);
  const grouped = sortedSlices.slice(MAX_VISIBLE_SLICES_WITH_GROUP);
  return [
    ...visible,
    createGroupedAllocationSlice(grouped, geometryTotal, todayKey),
  ];
}

function createGroupedAllocationSlice(
  members: readonly HoldingAllocationSlice[],
  geometryTotal: DecimalString,
  todayKey: string,
): HoldingAllocationSlice {
  const marketValue = members.reduce<DecimalString>(
    (sum, member) => add(sum, member.marketValue),
    "0",
  );
  return {
    assetSymbol: translateDefault("charts.series.other"),
    marketValue,
    ratio: toDecimalString(divide(marketValue, geometryTotal)),
    source: "grouped",
    asOf: todayKey,
    groupedMembers: members.map(({ assetSymbol, marketValue: memberValue }) => ({
      assetSymbol,
      marketValue: memberValue,
    })),
  };
}
