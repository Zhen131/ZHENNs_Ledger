import { calculatePositions } from "../calculators/positionCalculator";
import type {
  BinanceMarketMapping,
  LedgerData,
  PriceSnapshot,
} from "../models";
import type { BinanceMarketDataClient } from "../marketData/binanceMarketDataClient";
import type { BinanceMarketDataFailure } from "../marketData/binanceMarketDataTypes";
import {
  isSupportedValuationCurrency,
  partitionLedgerFactsForToday,
} from "../policies/ledgerFactPolicy";
import { isZero } from "../utils/decimalMath";
import {
  formatLocalDateKey,
  getLedgerDateKey,
  type LedgerClock,
} from "../utils/ledgerDate";

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
  const positions = calculatePositions(partition.activeTrades, []);
  const nonZeroSymbols = new Set(
    positions
      .filter((position) => !isZero(position.quantity))
      .map((position) => position.assetSymbol),
  );
  const targets = ledgerData.assets
    .filter(
      (asset) =>
        nonZeroSymbols.has(asset.symbol) &&
        isSupportedValuationCurrency(asset.quoteCurrency) &&
        asset.binanceMapping,
    )
    .map((asset) => ({
      assetSymbol: asset.symbol,
      mapping: asset.binanceMapping!,
    }));

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

  const responseTime = dependencies.clock.now();
  const fetchedAt = responseTime.toISOString();
  const recordedAt = formatLocalDateKey(responseTime);
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
    if (
      !asset ||
      !asset.binanceMapping ||
      asset.binanceMapping.symbol !== success.mapping.symbol ||
      !isSupportedValuationCurrency(asset.quoteCurrency)
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
      const existingIds = new Set(priceSnapshots.map((snapshot) => snapshot.id));
      let id: string | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = generateId();
        if (!existingIds.has(candidate)) {
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
        currency: asset.quoteCurrency,
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
        currency: asset.quoteCurrency,
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
