import type {
  BinanceMarketMapping,
  LedgerData,
} from "../models";
import type {
  BinanceMarketDataClient,
} from "../marketData/binanceMarketDataClient";
import type { BinanceMarketDataFailure } from "../marketData/binanceMarketDataTypes";

export type BinanceMappingValidationResult =
  | { ok: true; mapping: BinanceMarketMapping }
  | { ok: false; error: BinanceMarketDataFailure };

export function normalizeBinanceSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export async function validateBinanceMapping(
  client: BinanceMarketDataClient,
  assetSymbol: string,
  inputSymbol: string,
  signal?: AbortSignal,
): Promise<BinanceMappingValidationResult> {
  const symbol = normalizeBinanceSymbol(inputSymbol);
  const validation = await client.validateSpotSymbol(
    assetSymbol,
    symbol,
    signal,
  );
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    mapping: {
      provider: "binance",
      symbol: validation.value.symbol,
      baseAsset: validation.value.baseAsset,
      quoteAsset: "USDT",
    },
  };
}

export function setAssetBinanceMapping(
  ledgerData: LedgerData,
  assetSymbol: string,
  mapping: BinanceMarketMapping | null,
  updatedAt: string,
): LedgerData {
  let changed = false;
  const assets = ledgerData.assets.map((asset) => {
    if (asset.symbol !== assetSymbol) {
      return asset;
    }

    const currentSerialized = JSON.stringify(asset.binanceMapping ?? null);
    const nextSerialized = JSON.stringify(mapping);
    if (currentSerialized === nextSerialized) {
      return asset;
    }

    changed = true;
    return {
      ...asset,
      binanceMapping: mapping ? { ...mapping } : null,
      updatedAt,
    };
  });

  return changed ? { ...ledgerData, assets } : ledgerData;
}

export function getBinanceMappingSignature(ledgerData: LedgerData): string {
  return ledgerData.assets
    .map((asset) => {
      const mapping = asset.binanceMapping;
      return mapping
        ? `${asset.symbol}:${mapping.provider}:${mapping.symbol}:${mapping.baseAsset}:${mapping.quoteAsset}`
        : `${asset.symbol}:none`;
    })
    .sort()
    .join("|");
}
