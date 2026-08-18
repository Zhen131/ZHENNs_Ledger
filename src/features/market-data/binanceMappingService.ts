import type {
  BinanceMarketMapping,
  LedgerData,
} from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import type {
  BinanceMarketDataClient,
} from "@/platform/integrations";
import type { BinanceMarketDataFailure } from "@/platform/integrations";

export type BinanceMappingValidationResult =
  | { ok: true; mapping: BinanceMarketMapping }
  | { ok: false; error: BinanceMarketDataFailure };

export type BinanceSymbolCandidateResult =
  | { ok: true; symbol: string }
  | { ok: false; error: BinanceMarketDataFailure };

export type BinanceAutoPairSuccess = {
  assetSymbol: string;
  mapping: BinanceMarketMapping;
};

export type BinanceAutoPairFailure = BinanceMarketDataFailure & {
  assetSymbol: string;
};

export type BinanceAutoPairResult = {
  successes: BinanceAutoPairSuccess[];
  failures: BinanceAutoPairFailure[];
};

export function normalizeBinanceSymbolCandidate(
  localSymbol: string,
  input: string,
): BinanceSymbolCandidateResult {
  const normalized = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,64}$/.test(normalized)) {
    return {
      ok: false,
      error: {
        code: "BINANCE_INVALID_SYMBOL_INPUT",
        symbol: normalized,
        message: "Binance symbol input must contain 1 to 64 ASCII letters or digits",
      },
    };
  }
  return {
    ok: true,
    symbol: normalized === localSymbol ? `${normalized}USDT` : normalized,
  };
}

export async function validateBinanceMapping(
  client: BinanceMarketDataClient,
  assetSymbol: string,
  inputSymbol: string,
  signal?: AbortSignal,
): Promise<BinanceMappingValidationResult> {
  const candidate = normalizeBinanceSymbolCandidate(
    assetSymbol,
    inputSymbol,
  );
  if (!candidate.ok) return candidate;
  const symbol = candidate.symbol;
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

export function listAssetsMissingBinanceMapping(
  ledgerData: Pick<LedgerData, "assets">,
): string[] {
  return ledgerData.assets
    .filter((asset) => asset.binanceMapping === null)
    .map((asset) => asset.symbol)
    .sort((left, right) => left.localeCompare(right));
}

export async function autoPairMissingBinanceMappings(
  client: BinanceMarketDataClient,
  frozenAssetSymbols: readonly string[],
  signal?: AbortSignal,
): Promise<BinanceAutoPairResult> {
  const successes: BinanceAutoPairSuccess[] = [];
  const failures: BinanceAutoPairFailure[] = [];
  const orderedSymbols = Array.from(new Set(frozenAssetSymbols)).sort(
    (left, right) => left.localeCompare(right),
  );

  for (const assetSymbol of orderedSymbols) {
    if (signal?.aborted) break;
    const result = await validateBinanceMapping(
      client,
      assetSymbol,
      `${assetSymbol}USDT`,
      signal,
    );
    if (signal?.aborted) break;
    if (result.ok) {
      successes.push({ assetSymbol, mapping: result.mapping });
    } else {
      failures.push({ ...result.error, assetSymbol });
    }
  }

  return { successes, failures };
}

export function mergeAutoPairedBinanceMappings(
  ledgerData: LedgerData,
  successes: readonly BinanceAutoPairSuccess[],
  updatedAt: string,
): {
  ledgerData: LedgerData;
  appliedAssetSymbols: string[];
  skippedAssetSymbols: string[];
} {
  const successBySymbol = new Map(
    successes.map((success) => [success.assetSymbol, success.mapping]),
  );
  const appliedAssetSymbols: string[] = [];
  const assets = ledgerData.assets.map((asset) => {
    const mapping = successBySymbol.get(asset.symbol);
    if (!mapping || asset.binanceMapping !== null) return asset;
    appliedAssetSymbols.push(asset.symbol);
    return {
      ...asset,
      binanceMapping: { ...mapping },
      updatedAt,
    };
  });
  const appliedSet = new Set(appliedAssetSymbols);
  const skippedAssetSymbols = Array.from(successBySymbol.keys()).filter(
    (symbol) => !appliedSet.has(symbol),
  );
  return {
    ledgerData:
      appliedAssetSymbols.length === 0 ? ledgerData : { ...ledgerData, assets },
    appliedAssetSymbols,
    skippedAssetSymbols,
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

    const currentSerialized = JSON.stringify(asset.binanceMapping);
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
      const mapping = resolveAssetBinanceMappingForRuntime(asset);
      return mapping
        ? `${asset.symbol}:${mapping.provider}:${mapping.symbol}:${mapping.baseAsset}:${mapping.quoteAsset}`
        : `${asset.symbol}:none`;
    })
    .sort()
    .join("|");
}
