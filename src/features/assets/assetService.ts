/**
 * 这个文件管本地币清单：加币、查谁用着、删币。
 * 它不联网、不管币安对，币安对在 market-data 功能区。
 * 不显然的决定：有记录用着的币不许删，也不连带删；2026-08-19 定（W14 01B 第 4.2 节）。
 */
import type {
  Asset,
  ISODateTimeString,
  LedgerData,
} from "@/core/models";
import { isZero, systemLedgerClock } from "@/core/shared";
import { isTechnicalId, validateLedgerData } from "@/core/validation";

/** 为什么最多试 3 次：2026-08-19 定（W14 01B 第 3.5 节）。 */
const MAX_ASSET_ID_GENERATION_ATTEMPTS = 3;
/**
 * 币的清单最多 500 种。
 * 为什么是 500：2026-08-19 定（W14 01B 第 3.5 节）。
 */
const MAX_ASSETS = 500;
/**
 * 删不掉时，每类记录最多列出 5 个位置给人看。
 * 为什么是 5：日志里只写「前若干」，这是猜的，要核。
 */
const MAX_REPORTED_PATHS = 5;
/**
 * 币的代码只许 1～32 个大写字母或数字。
 * 这条 2026-08-19 定（W14 01B 第 4.1 节）。
 */
const SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

/**
 * 新加或删除一种币可能失败的原因，一种一个代码。
 * 界面按代码分支，不去读说明文字。
 */
export const ASSET_ERROR_CODES = {
  INVALID_SYMBOL: "ASSET_INVALID_SYMBOL",
  RESERVED_SYMBOL: "ASSET_RESERVED_SYMBOL",
  DUPLICATE_SYMBOL: "ASSET_DUPLICATE_SYMBOL",
  NOT_FOUND: "ASSET_NOT_FOUND",
  DEPENDENCY_EXISTS: "ASSET_DEPENDENCY_EXISTS",
  ID_GENERATION_EXHAUSTED: "ASSET_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "ASSET_DEPENDENCY_FAILURE",
  LIMIT_REACHED: "ASSET_LIMIT_REACHED",
  LEDGER_VALIDATION_FAILED: "ASSET_LEDGER_VALIDATION_FAILED",
} as const;

/** `ASSET_ERROR_CODES` 里任意一个代码。 */
export type AssetErrorCode =
  (typeof ASSET_ERROR_CODES)[keyof typeof ASSET_ERROR_CODES];

/**
 * 可能用着一种币的四类记录。
 * 它们是买卖、转账、价格、手续费规则。
 */
export type AssetDependencyCollection =
  | "trades"
  | "assetTransfers"
  | "priceSnapshots"
  | "feeRules";

/** 一类记录里有多少条用着这种币，前几条在哪个位置。 */
export type AssetDependencySummary = Readonly<{
  collection: AssetDependencyCollection;
  count: number;
  paths: readonly string[];
}>;

type AssetServiceError = Readonly<{
  code: AssetErrorCode;
  message: string;
  dependencies?: readonly AssetDependencySummary[];
  operation?: "generateId" | "now";
}>;

type NormalizeAssetSymbolResult =
  | { ok: true; symbol: string }
  | { ok: false; error: AssetServiceError };

type CreateLocalAssetResult =
  | { ok: true; asset: Asset }
  | { ok: false; error: AssetServiceError };

type RemoveLocalAssetResult =
  | { ok: true; ledgerData: LedgerData }
  | { ok: false; error: AssetServiceError };

type AssetServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
}>;

/**
 * 这个函数回答：人填的币代码，规整后是什么？合不合规矩？
 * 去掉前后空格、变大写，再看是不是 1～32 个字母或数字。
 * 举例：「 sol 」→ 答「SOL」。
 * 举例：「USDT」→ 答不行，它留给现金用。
 * 不合规矩时返回 `ok:false` 和代码，不抛错。
 */
export function normalizeAssetSymbol(
  input: unknown,
): NormalizeAssetSymbolResult {
  if (typeof input !== "string") {
    return failure(
      ASSET_ERROR_CODES.INVALID_SYMBOL,
      "Asset symbol must be a string",
    );
  }
  const symbol = input.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    return failure(
      ASSET_ERROR_CODES.INVALID_SYMBOL,
      "Asset symbol must contain 1 to 32 uppercase ASCII letters or digits",
    );
  }
  if (symbol === "USDT") {
    return failure(
      ASSET_ERROR_CODES.RESERVED_SYMBOL,
      "USDT is reserved for the cash pool",
    );
  }
  return { ok: true, symbol };
}

/**
 * 这个函数回答：能不能新加这种币？能就造出一种。
 * 全程不联网，名字就用代码，计价用 USDT，没有币安对。
 * 举例：清单里没有 SOL，填「sol」→ 答新币 SOL。
 * 已经有了、清单满 500 种、编号撞了 3 次：返回 `ok:false`，不抛错。
 */
export function createLocalAsset(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: AssetServiceDependencies,
): CreateLocalAssetResult {
  const normalized = normalizeAssetSymbol(input);
  if (!normalized.ok) return normalized;
  if (
    ledgerData.assets.some((asset) => asset.symbol === normalized.symbol)
  ) {
    return failure(
      ASSET_ERROR_CODES.DUPLICATE_SYMBOL,
      `Asset ${normalized.symbol} already exists`,
    );
  }
  if (ledgerData.assets.length >= MAX_ASSETS) {
    return failure(
      ASSET_ERROR_CODES.LIMIT_REACHED,
      `Asset limit ${MAX_ASSETS} reached`,
    );
  }

  const dependencies = providedDependencies ?? {
    generateId: () => globalThis.crypto.randomUUID(),
    now: () => systemLedgerClock.now().toISOString(),
  };
  const existingIds = collectLedgerIds(ledgerData);
  let id: string | undefined;
  for (
    let attempt = 0;
    attempt < MAX_ASSET_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    let candidate: string;
    try {
      candidate = dependencies.generateId();
    } catch {
      return dependencyFailure("generateId");
    }
    if (isTechnicalId(candidate) && !existingIds.has(candidate)) {
      id = candidate;
      break;
    }
  }
  if (id === undefined) {
    return failure(
      ASSET_ERROR_CODES.ID_GENERATION_EXHAUSTED,
      "Could not generate a unique asset ID after 3 attempts",
    );
  }

  let timestamp: ISODateTimeString;
  try {
    timestamp = dependencies.now();
  } catch {
    return dependencyFailure("now");
  }
  const asset: Asset = {
    id,
    symbol: normalized.symbol,
    name: normalized.symbol,
    quoteCurrency: "USDT",
    binanceMapping: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const validation = validateLedgerData({
    ...ledgerData,
    assets: [...ledgerData.assets, asset],
  });
  if (!validation.ok) {
    return failure(
      ASSET_ERROR_CODES.LEDGER_VALIDATION_FAILED,
      validation.errors[0]?.message ?? "Asset did not pass ledger validation",
    );
  }
  return { ok: true, asset };
}

/**
 * 这个函数回答：这种币被哪些记录用着？
 * 买卖、转账、价格、手续费规则都看，全部列出。
 * 用这种币付的手续费也算。
 * 举例：SOL 有 2 笔买卖、1 条价格 → 答两类，各带位置。
 * 手续费为 0 的那笔不算用着。
 * 不会出错。
 */
export function inspectAssetDependencies(
  symbol: string,
  ledgerData: LedgerData,
): AssetDependencySummary[] {
  const pathsByCollection: Record<AssetDependencyCollection, string[]> = {
    trades: [],
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
  ledgerData.trades.forEach((trade, index) => {
    if (trade.assetSymbol === symbol) {
      pathsByCollection.trades.push(`trades[${index}].assetSymbol`);
    }
    if (!isZero(trade.fee) && trade.feeCurrency === symbol) {
      pathsByCollection.trades.push(`trades[${index}].feeCurrency`);
    }
  });
  ledgerData.assetTransfers.forEach((assetTransfer, index) => {
    if (assetTransfer.assetSymbol === symbol) {
      pathsByCollection.assetTransfers.push(
        `assetTransfers[${index}].assetSymbol`,
      );
    }
  });
  ledgerData.priceSnapshots.forEach((snapshot, index) => {
    if (snapshot.assetSymbol === symbol) {
      pathsByCollection.priceSnapshots.push(
        `priceSnapshots[${index}].assetSymbol`,
      );
    }
  });
  ledgerData.feeRules.forEach((rule, index) => {
    if (rule.assetSymbol === symbol) {
      pathsByCollection.feeRules.push(`feeRules[${index}].assetSymbol`);
    }
  });

  return (
    Object.entries(pathsByCollection) as Array<
      [AssetDependencyCollection, string[]]
    >
  )
    .filter(([, paths]) => paths.length > 0)
    .map(([collection, paths]) => ({
      collection,
      count: paths.length,
      paths: paths.slice(0, MAX_REPORTED_PATHS),
    }));
}

/**
 * 这个函数回答：这种币能不能删？能就返回删掉后的账本。
 * 有任何记录用着就拒绝，并列出被谁用着。
 * 举例：SOL 还有一条价格 → 答不能删，先删那条价格。
 * 币安对不算用着，随币一起删掉。
 * 不抛错，失败返回 `ok:false`。
 */
export function removeLocalAsset(
  input: unknown,
  ledgerData: LedgerData,
): RemoveLocalAssetResult {
  const normalized = normalizeAssetSymbol(input);
  if (!normalized.ok) return normalized;
  if (
    !ledgerData.assets.some((asset) => asset.symbol === normalized.symbol)
  ) {
    return failure(
      ASSET_ERROR_CODES.NOT_FOUND,
      `Asset ${normalized.symbol} was not found`,
    );
  }
  const dependencies = inspectAssetDependencies(
    normalized.symbol,
    ledgerData,
  );
  if (dependencies.length > 0) {
    return {
      ok: false,
      error: {
        code: ASSET_ERROR_CODES.DEPENDENCY_EXISTS,
        message: `Asset ${normalized.symbol} still has ledger dependencies`,
        dependencies,
      },
    };
  }
  return {
    ok: true,
    ledgerData: {
      ...ledgerData,
      assets: ledgerData.assets.filter(
        (asset) => asset.symbol !== normalized.symbol,
      ),
    },
  };
}

function collectLedgerIds(ledgerData: LedgerData): Set<string> {
  return new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function dependencyFailure(
  operation: "generateId" | "now",
): CreateLocalAssetResult {
  return {
    ok: false,
    error: {
      code: ASSET_ERROR_CODES.DEPENDENCY_FAILURE,
      message: `Asset dependency failed during ${operation}`,
      operation,
    },
  };
}

function failure(
  code: AssetErrorCode,
  message: string,
): { ok: false; error: AssetServiceError } {
  return { ok: false, error: { code, message } };
}
