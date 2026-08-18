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
import {
  captureLedgerTime,
  getLedgerDateKey,
  type LedgerClock,
} from "@/core/shared";

export type BinanceRefreshSuccess = {
  assetSymbol: string;
  mapping: BinanceMarketMapping;
  price: string;
  recordedAt: string;
  fetchedAt: string;
};

export type BinanceAssetRefreshFailure = BinanceMarketDataFailure & {
  assetSymbol: string;
};

export type BinancePriceRefreshResult = {
  successes: BinanceRefreshSuccess[];
  failures: BinanceAssetRefreshFailure[];
};

export type BinancePriceRefreshDependencies = {
  client: BinanceMarketDataClient;
  clock: LedgerClock;
};

export async function refreshBinancePrices(
  ledgerData: LedgerData,
  todayKey: string,
  dependencies: BinancePriceRefreshDependencies,
  signal?: AbortSignal,
): Promise<BinancePriceRefreshResult> {
  const partition = partitionLedgerFactsForToday(ledgerData, todayKey);
  const positions = replayPositions(partition.activeTrades);
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

export type BinanceRefreshMergeResult = {
  ledgerData: LedgerData;
  appliedAssetSymbols: string[];
  skippedAssetSymbols: string[];
};

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

function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
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
