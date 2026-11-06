/**
 * 这个文件管一件事：一种币到某天为止用哪个价格。
 * 它不管价格怎么记下来，那在 prices 功能区；也不管拿价格算市值，那在 `positionService.ts`。
 * 不显然的决定：同一天两种价都有时用币安价；这是猜的，要核。
 */
import type {
  Asset,
  PriceSnapshot,
  ValuationPriceMode,
} from "@/core/models";
import {
  isSupportedValuationCurrency,
} from "@/core/policies";
import {
  compareLedgerFactOrder,
  getLedgerDateKey,
  toPriceSnapshotOrderInput,
} from "@/core/shared";

/**
 * 挑中的价格：哪条价格、什么币种、来源、算到哪个时刻。
 * 来源只有手动和币安两种。
 * 给持仓估值和走势图用。
 */
export type SelectedPrice = {
  snapshot: PriceSnapshot;
  effectiveCurrency: "USD" | "USDT";
  actualSource: "manual" | "binance";
  asOf: string;
};

type PriceCandidate = {
  snapshot: PriceSnapshot;
};

/**
 * 一边看价格一边挑的「草稿」。
 * 它分别记着最新的手动价和最新的币安价。
 * 走势图按天往前走时用它，免得每天从头挑。
 */
export type PriceSelectionAccumulator = {
  readonly asset: Asset;
  readonly mode: ValuationPriceMode;
  manual?: PriceCandidate;
  binance?: PriceCandidate;
};

/**
 * 这个函数开一张空的挑价草稿，记住是哪种币、用哪种挑法。
 * 举例：BTC，「自动」模式。
 * → 答一张记着 BTC 和「自动」、0 条价格的草稿。
 * 不会出错。
 */
export function createPriceSelectionAccumulator(
  asset: Asset,
  mode: ValuationPriceMode,
): PriceSelectionAccumulator {
  return { asset, mode };
}

/**
 * 这个函数把一条记下来的价格放进草稿里比一比。
 * 币种对不上的、来源不认识的，直接不看。
 * 同一来源里，排得更晚的那条换掉旧的。
 * 举例：草稿里有手动价 68000（8 月 20 日）。
 * 再放进手动价 69000（8 月 21 日）→ 草稿里的手动价变成 69000。
 * 不会出错。
 */
export function considerPriceSnapshot(
  accumulator: PriceSelectionAccumulator,
  snapshot: PriceSnapshot,
): void {
  const source = classifyCandidate(snapshot, accumulator.asset);
  if (!source) {
    return;
  }

  const current = accumulator[source];
  if (
    !current ||
    compareLedgerFactOrder(
      toPriceSnapshotOrderInput(snapshot),
      toPriceSnapshotOrderInput(current.snapshot),
    ) >= 0
  ) {
    accumulator[source] = { snapshot };
  }
}


/**
 * 这个函数回答：按草稿里的价格，最后用哪一个？
 * 「只用手动价」模式且有手动价：用手动价。
 * 「自动」模式只有一边时，就用那一边。
 * 两边都有时，手动价日期更晚才用手动价，否则用币安价。
 * 举例：手动价 68000 在 8 月 20 日，币安价 70000 在 8 月 21 日。
 * → 答币安 70000。
 * 为什么同一天算币安的：这是猜的，日志里没写，要核。
 * 一个价格都没有时返回空。
 */
export function getSelectedPrice(
  accumulator: PriceSelectionAccumulator,
): SelectedPrice | undefined {
  const manual = accumulator.manual?.snapshot;
  const binance = accumulator.binance?.snapshot;

  if (accumulator.mode === "manual" && manual) {
    return toSelectedPrice(manual, "manual");
  }
  if (!manual) {
    return binance ? toSelectedPrice(binance, "binance") : undefined;
  }
  if (!binance) {
    return toSelectedPrice(manual, "manual");
  }

  return getLedgerDateKey(manual.recordedAt) >
    getLedgerDateKey(binance.recordedAt)
    ? toSelectedPrice(manual, "manual")
    : toSelectedPrice(binance, "binance");
}

/**
 * 这个函数回答：到某一天为止，这种币该用哪个价格？
 * 只看那天和之前记下来的价格，挑法同 `getSelectedPrice`。
 * 举例：问 8 月 22 日，有 21 日币安价 70000、23 日手动价 72000。
 * → 答 70000，23 日那条还不算数。
 * 这种币不是用 USDT 计价时，直接返回空。
 * 不会出错。
 */
export function selectPriceAsOf(
  snapshots: readonly PriceSnapshot[],
  asset: Asset,
  dateKey: string,
  mode: ValuationPriceMode,
): SelectedPrice | undefined {
  if (!isSupportedValuationCurrency(asset.quoteCurrency)) {
    return undefined;
  }

  const accumulator = createPriceSelectionAccumulator(asset, mode);
  snapshots.forEach((snapshot) => {
    if (getLedgerDateKey(snapshot.recordedAt) <= dateKey) {
      considerPriceSnapshot(accumulator, snapshot);
    }
  });
  return getSelectedPrice(accumulator);
}

function classifyCandidate(
  snapshot: PriceSnapshot,
  asset: Asset,
): "manual" | "binance" | undefined {
  if (
    snapshot.assetSymbol !== asset.symbol ||
    !isSupportedValuationCurrency(snapshot.currency) ||
    snapshot.currency !== asset.quoteCurrency
  ) {
    return undefined;
  }
  if (snapshot.source === "manual") {
    return "manual";
  }
  return snapshot.source === "api" &&
    snapshot.binanceProvenance?.provider === "binance" &&
    snapshot.binanceProvenance.sourceQuoteCurrency === "USDT"
    ? "binance"
    : undefined;
}

function toSelectedPrice(
  snapshot: PriceSnapshot,
  actualSource: "manual" | "binance",
): SelectedPrice {
  return {
    snapshot,
    effectiveCurrency: snapshot.currency as "USD" | "USDT",
    actualSource,
    asOf:
      actualSource === "binance"
        ? snapshot.binanceProvenance!.fetchedAt
        : snapshot.recordedAt,
  };
}
