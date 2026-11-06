/**
 * 这个文件管本地币和币安交易对的对应关系。
 * 验证、自动配对、写进账本都在这里。
 * 真正联网的那段在 platform 的币安客户端里。
 * 不显然的决定：只认币安现货的 USDT 交易对；2026-08-19 定（W14 01B 第 5.1 节）。
 */
import type {
  BinanceMarketMapping,
  LedgerData,
} from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import type {
  BinanceMarketDataClient,
} from "@/platform/integrations";
import type { BinanceMarketDataFailure } from "@/platform/integrations";

type BinanceMappingValidationResult =
  | { ok: true; mapping: BinanceMarketMapping }
  | { ok: false; error: BinanceMarketDataFailure };

type BinanceSymbolCandidateResult =
  | { ok: true; symbol: string }
  | { ok: false; error: BinanceMarketDataFailure };

/** 自动配对成功的一种币：本地代码和配上的币安交易对。 */
export type BinanceAutoPairSuccess = {
  assetSymbol: string;
  mapping: BinanceMarketMapping;
};

/** 自动配对失败的一种币：本地代码，加上失败代码和说明。 */
export type BinanceAutoPairFailure = BinanceMarketDataFailure & {
  assetSymbol: string;
};

type BinanceAutoPairResult = {
  successes: BinanceAutoPairSuccess[];
  failures: BinanceAutoPairFailure[];
};

/**
 * 这个函数回答：人填的币安交易对，规整后去查哪个？
 * 去前后空格、变大写，只许 1～64 个字母或数字。
 * 填的正好是本地代码，就自动补上 USDT。
 * 举例：本地 SOL，填「sol」→ 答 SOLUSDT；填「SOLUSDT」→ 照原样。
 * 写法不对时返回 `ok:false`，不联网。
 * 这几条 2026-08-19 定（W14 01B 第 5.1 节）。
 */
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

/**
 * 这个函数回答：这个交易对在币安上能不能用？能就给出对应关系。
 * 只发一次查询，不重试。
 * 举例：本地 SOL，填 SOL → 查 SOLUSDT，正在交易就答能用。
 * 联网失败、交易对不存在、不在交易时，返回 `ok:false` 和代码。
 */
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

/**
 * 这个函数回答：哪些币还没配币安交易对？按字母顺序给出代码。
 * 举例：BTC 配了，SOL、DOGE 没配 → 答 DOGE、SOL。
 * 不会出错。
 */
export function listAssetsMissingBinanceMapping(
  ledgerData: Pick<LedgerData, "assets">,
): string[] {
  return ledgerData.assets
    .filter((asset) => asset.binanceMapping === null)
    .map((asset) => asset.symbol)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * 这个函数把没配的币按字母顺序一个个去币安查。
 * 查的是「代码 + USDT」。
 * 每个只查一次，不重试；中途取消就停下。
 * 举例：DOGE、SOL → 依次查 DOGEUSDT、SOLUSDT。
 * 返回成功和失败两张清单，失败的不影响成功的。
 * 为什么一个个查：2026-08-19 定（W14 01B 第 5.3 节）。
 */
export async function autoPairMissingBinanceMappings(
  client: BinanceMarketDataClient,
  frozenAssetSymbols: readonly string[],
  signal?: AbortSignal,
): Promise<BinanceAutoPairResult> {
  const successes: BinanceAutoPairSuccess[] = [];
  const failures: BinanceAutoPairFailure[] = [];
  const orderedSymbols = Array.from(new Set(frozenAssetSymbols)).sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
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

/**
 * 这个函数把自动配对成功的结果写进账本里的币。
 * 已经有对应关系的币不覆盖，列进「跳过」。
 * 举例：DOGE 配上了，但这期间人手动给 DOGE 配过 → 跳过 DOGE。
 * 一个都没写时，原样返回那本账。
 */
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

/**
 * 这个函数给一种币设上或去掉币安交易对。
 * 传空就是去掉；和原来一样就什么都不改。
 * 只改对应关系和更新时间，币、买卖、价格都不动。
 */
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

/**
 * 这个函数把全部币的对应关系拼成一串字。
 * 用它来看对应关系变没变。
 * 举例：BTC 配 BTCUSDT、SOL 没配 → 答「BTC:binance:BTCUSDT:BTC:USDT|SOL:none」。
 * 两次拿到的字不一样，就说明中间有人改过对应关系。
 */
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
