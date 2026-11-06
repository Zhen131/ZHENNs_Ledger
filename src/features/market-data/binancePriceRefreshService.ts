/**
 * 这个文件管一件事：从币安取回手里那些币的最新价格。
 * 取回的价格再合进账本。
 * 联网的细节在 platform 的币安客户端里，按钮在 `MarketDataControls.tsx`。
 * 不显然的决定：一种币一天只留一条币安价，后取的覆盖。
 * 这条 2026-08-19 定（W14 01B 第 5.2 节）。
 */
import { replayPositions } from "@/core/calculations";
import type {
  BinanceMarketMapping,
  LedgerData,
  PriceSnapshot,
} from "@/core/models";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { BinanceMarketDataFailure } from "@/platform/integrations";
import {
  partitionLedgerFactsForToday,
  resolveAssetBinanceMappingForRuntime,
} from "@/core/policies";
import { isZero } from "@/core/shared";
import { isTechnicalId } from "@/core/validation";
import {
  captureLedgerTime,
  getLedgerDateKey,
  type LedgerClock,
} from "@/core/shared";

/**
 * 取价成功的一种币：本地代码、交易对、价格。
 * 还有算哪天、什么时刻取的。
 */
export type BinanceRefreshSuccess = {
  assetSymbol: string;
  mapping: BinanceMarketMapping;
  price: string;
  recordedAt: string;
  fetchedAt: string;
};

/** 取价失败的一种币：本地代码，加上币安的失败代码和说明。 */
export type BinanceAssetRefreshFailure = BinanceMarketDataFailure & {
  assetSymbol: string;
};

type BinancePriceRefreshResult = {
  successes: BinanceRefreshSuccess[];
  failures: BinanceAssetRefreshFailure[];
};

type BinancePriceRefreshDependencies = {
  client: BinanceMarketDataClient;
  clock: LedgerClock;
};

/**
 * 这个函数回答：手里有、又配了交易对的币，币安价多少？
 * 先逐个确认交易对还能用，再一次取回全部价格。
 * 举例：手里有 BTC、SOL，只有 BTC 配了 → 只取 BTCUSDT。
 * 它只取价，不改账本；合进账本用 `mergeBinancePriceRefresh`。
 * 失败的币列进失败清单，不影响别的币。
 */
export async function refreshBinancePrices(
  ledgerData: LedgerData,
  todayKey: string,
  dependencies: BinancePriceRefreshDependencies,
  signal?: AbortSignal,
): Promise<BinancePriceRefreshResult> {
  const partition = partitionLedgerFactsForToday(ledgerData, todayKey);
  const positions = replayPositions(
    partition.activeTrades,
    partition.activeAssetTransfers,
  );
  const nonZeroSymbols = new Set(
    positions
      .filter((position) => !isZero(position.quantity))
      .map((position) => position.assetSymbol),
  );
  const targets = ledgerData.assets.flatMap((asset) => {
    if (
      !nonZeroSymbols.has(asset.symbol) ||
      asset.quoteCurrency !== "USDT"
    ) {
      return [];
    }
    const mapping = resolveAssetBinanceMappingForRuntime(asset);
    return mapping
      ? [{ assetSymbol: asset.symbol, mapping }]
      : [];
  });

  const failures: BinanceAssetRefreshFailure[] = [];
  const validatedTargets: typeof targets = [];
  const validations = await Promise.all(
    targets.map(async (target) => {
      const validation = await dependencies.client.validateSpotSymbol(
        target.assetSymbol,
        target.mapping.symbol,
        signal,
      );
      return { target, validation };
    }),
  );
  for (const { target, validation } of validations) {
    if (validation.ok) {
      validatedTargets.push(target);
    } else {
        failures.push({
          ...validation.error,
          assetSymbol: target.assetSymbol,
        });
    }
  }

  if (validatedTargets.length === 0) {
    return { successes: [], failures };
  }

  const tickerResult = await dependencies.client.fetchLatestPrices(
    validatedTargets.map((target) => target.mapping.symbol),
    signal,
  );
  const targetByMarketSymbol = new Map(
    validatedTargets.map((target) => [target.mapping.symbol, target]),
  );
  for (const tickerFailure of tickerResult.failures) {
    const target = targetByMarketSymbol.get(tickerFailure.symbol);
    if (target) {
      failures.push({
        ...tickerFailure,
        assetSymbol: target.assetSymbol,
      });
    }
  }

  const responseTime = captureLedgerTime(dependencies.clock);
  const fetchedAt = responseTime.now.toISOString();
  const recordedAt = responseTime.todayKey;
  const successes = tickerResult.prices.flatMap((ticker) => {
    const target = targetByMarketSymbol.get(ticker.symbol);
    return target
      ? [
          {
            assetSymbol: target.assetSymbol,
            mapping: target.mapping,
            price: ticker.price,
            fetchedAt,
            recordedAt,
          },
        ]
      : [];
  });

  return { successes, failures };
}

type BinanceRefreshMergeResult = {
  ledgerData: LedgerData;
  appliedAssetSymbols: string[];
  skippedAssetSymbols: string[];
};

/**
 * 这个函数把取回的价格合进账本。
 * 每种币当天只留一条币安价。
 * 当天已有币安价就改那一条，没有就新加一条。
 * 举例：BTC 今天上午取过 69000，下午取到 70000 → 那一条改成 70000。
 * 取价后对应关系被改过的币不合，列进「跳过」。
 * 编号撞了 3 次的也跳过。
 */
export function mergeBinancePriceRefresh(
  ledgerData: LedgerData,
  successes: readonly BinanceRefreshSuccess[],
  generateId: () => string,
): BinanceRefreshMergeResult {
  let priceSnapshots = ledgerData.priceSnapshots;
  const appliedAssetSymbols: string[] = [];
  const skippedAssetSymbols: string[] = [];

  for (const success of successes) {
    const asset = ledgerData.assets.find(
      (candidate) => candidate.symbol === success.assetSymbol,
    );
    const currentMapping = asset
      ? resolveAssetBinanceMappingForRuntime(asset)
      : null;
    if (
      !asset ||
      !currentMapping ||
      currentMapping.provider !== success.mapping.provider ||
      currentMapping.symbol !== success.mapping.symbol ||
      currentMapping.baseAsset !== success.mapping.baseAsset ||
      currentMapping.quoteAsset !== success.mapping.quoteAsset ||
      asset.quoteCurrency !== "USDT"
    ) {
      skippedAssetSymbols.push(success.assetSymbol);
      continue;
    }

    const duplicateIndexes: number[] = [];
    priceSnapshots.forEach((snapshot, index) => {
      if (
        snapshot.assetSymbol === success.assetSymbol &&
        snapshot.source === "api" &&
        snapshot.binanceProvenance?.provider === "binance" &&
        getLedgerDateKey(snapshot.recordedAt) === success.recordedAt
      ) {
        duplicateIndexes.push(index);
      }
    });

    const canonicalIndex = chooseCanonicalBinanceSnapshot(
      priceSnapshots,
      duplicateIndexes,
    );
    let canonical: PriceSnapshot | undefined =
      canonicalIndex === undefined ? undefined : priceSnapshots[canonicalIndex];
    if (!canonical) {
      const existingIds = new Set(
        [
          ...ledgerData.assets,
          ...ledgerData.trades,
          ...ledgerData.cashEvents,
          ...ledgerData.assetTransfers,
          ...priceSnapshots,
          ...ledgerData.feeRules,
        ].map(({ id }) => id),
      );
      let id: string | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let candidate: string;
        try {
          candidate = generateId();
        } catch {
          break;
        }
        if (isTechnicalId(candidate) && !existingIds.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) {
        skippedAssetSymbols.push(success.assetSymbol);
        continue;
      }
      canonical = {
        id,
        assetSymbol: success.assetSymbol,
        price: success.price,
        currency: "USDT",
        recordedAt: success.recordedAt,
        source: "api",
        binanceProvenance: {
          provider: "binance",
          symbol: success.mapping.symbol,
          sourceQuoteCurrency: "USDT",
          fetchedAt: success.fetchedAt,
        },
        createdAt: success.fetchedAt,
        updatedAt: success.fetchedAt,
      };
      priceSnapshots = [...priceSnapshots, canonical];
    } else {
      const updated: PriceSnapshot = {
        ...canonical,
        price: success.price,
        currency: "USDT",
        recordedAt: success.recordedAt,
        source: "api",
        binanceProvenance: {
          provider: "binance",
          symbol: success.mapping.symbol,
          sourceQuoteCurrency: "USDT",
          fetchedAt: success.fetchedAt,
        },
        updatedAt: success.fetchedAt,
      };
      priceSnapshots = priceSnapshots.flatMap((snapshot, index) => {
        if (!duplicateIndexes.includes(index)) {
          return [snapshot];
        }
        return index === canonicalIndex ? [updated] : [];
      });
    }

    appliedAssetSymbols.push(success.assetSymbol);
  }

  return {
    ledgerData:
      priceSnapshots === ledgerData.priceSnapshots
        ? ledgerData
        : { ...ledgerData, priceSnapshots },
    appliedAssetSymbols,
    skippedAssetSymbols,
  };
}

function chooseCanonicalBinanceSnapshot(
  snapshots: readonly PriceSnapshot[],
  indexes: readonly number[],
): number | undefined {
  let canonicalIndex: number | undefined;
  for (const index of indexes) {
    if (canonicalIndex === undefined) {
      canonicalIndex = index;
      continue;
    }
    const currentFetchedAt =
      snapshots[canonicalIndex].binanceProvenance?.fetchedAt ?? "";
    const candidateFetchedAt =
      snapshots[index].binanceProvenance?.fetchedAt ?? "";
    const timeOrder =
      Date.parse(candidateFetchedAt) - Date.parse(currentFetchedAt);
    if (timeOrder > 0 || (timeOrder === 0 && index > canonicalIndex)) {
      canonicalIndex = index;
    }
  }
  return canonicalIndex;
}
