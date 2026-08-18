import type {
  Asset,
  ISODateTimeString,
  LedgerData,
} from "@/core/models";
import { isZero, systemLedgerClock } from "@/core/shared";
import { validateLedgerData } from "@/core/validation";

const MAX_ASSET_ID_GENERATION_ATTEMPTS = 3;
const MAX_ASSETS = 500;
const MAX_REPORTED_PATHS = 5;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

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

export type AssetErrorCode =
  (typeof ASSET_ERROR_CODES)[keyof typeof ASSET_ERROR_CODES];

export type AssetDependencyCollection =
  | "trades"
  | "priceSnapshots"
  | "feeRules";

export type AssetDependencySummary = Readonly<{
  collection: AssetDependencyCollection;
  count: number;
  paths: readonly string[];
}>;

export type AssetServiceError = Readonly<{
  code: AssetErrorCode;
  message: string;
  dependencies?: readonly AssetDependencySummary[];
  operation?: "generateId" | "now";
}>;

export type NormalizeAssetSymbolResult =
  | { ok: true; symbol: string }
  | { ok: false; error: AssetServiceError };

export type CreateLocalAssetResult =
  | { ok: true; asset: Asset }
  | { ok: false; error: AssetServiceError };

export type RemoveLocalAssetResult =
  | { ok: true; ledgerData: LedgerData }
  | { ok: false; error: AssetServiceError };

export type AssetServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
}>;

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

export function inspectAssetDependencies(
  symbol: string,
  ledgerData: LedgerData,
): AssetDependencySummary[] {
  const pathsByCollection: Record<AssetDependencyCollection, string[]> = {
    trades: [],
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
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
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
