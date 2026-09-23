import type { Asset, LedgerData } from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import { type BinanceMarketDataFailure } from "@/platform/integrations";
import type {
  AssetOperation,
  Translate,
  GlobalRefreshState,
  GlobalOperation,
} from "./marketDataControlsTypes";

export function createInitialRefreshState(t: Translate): GlobalRefreshState {
  return {
  status: "idle",
  message: t("marketData.refresh.initial"),
  failures: [],
  };
}

export function isAssetOperationContextCurrent(
  operation: AssetOperation,
  latest: {
    ledgerData: LedgerData;
    ledgerEpoch: number;
    sessionGeneration: number;
    isWritable: boolean;
    mappingSignature: string;
  },
): boolean {
  if (
    !latest.isWritable ||
    operation.controller.signal.aborted ||
    latest.ledgerEpoch !== operation.ledgerEpoch ||
    latest.sessionGeneration !== operation.sessionGeneration
  ) {
    return false;
  }
  const asset = latest.ledgerData.assets.find(
    (candidate) => candidate.id === operation.assetId,
  );
  if (!asset || asset.symbol !== operation.assetSymbol) return false;
  const expectedSignature =
    operation.phase === "validating"
      ? operation.startMappingSignature
      : operation.expectedMappingSignature;
  return latest.mappingSignature === expectedSignature;
}

export function isGlobalOperationContextCurrent(
  operation: GlobalOperation,
  latest: {
    ledgerEpoch: number;
    sessionGeneration: number;
    isWritable: boolean;
    mappingSignature: string;
  },
): boolean {
  return (
    latest.isWritable &&
    !operation.controller.signal.aborted &&
    latest.ledgerEpoch === operation.ledgerEpoch &&
    latest.sessionGeneration === operation.sessionGeneration &&
    latest.mappingSignature === operation.mappingSignature
  );
}

export function createMappingDrafts(
  assets: readonly Asset[],
): Record<string, string> {
  return Object.fromEntries(
    assets.map((asset) => [
      asset.symbol,
      resolveAssetBinanceMappingForRuntime(asset)?.symbol ?? "",
    ]),
  );
}

export function formatBinanceFailure(
  failure: BinanceMarketDataFailure,
  t: Translate,
): string {
  const labels: Record<BinanceMarketDataFailure["code"], string> = {
    BINANCE_INVALID_SYMBOL_INPUT: t("marketData.failure.invalidSymbolInput"),
    BINANCE_ABORTED: t("marketData.failure.aborted"),
    BINANCE_TIMEOUT: t("marketData.failure.timeout"),
    BINANCE_VALIDATION_UNAVAILABLE: t("marketData.failure.validationUnavailable"),
    BINANCE_NETWORK_ERROR: t("marketData.failure.network"),
    BINANCE_HTTP_ERROR: `${t("marketData.failure.http")}${failure.httpStatus ? ` ${failure.httpStatus}` : ""}`,
    BINANCE_RATE_LIMITED: `${t("marketData.failure.rateLimited")}${failure.httpStatus ? ` ${failure.httpStatus}` : ""}`,
    BINANCE_MALFORMED_RESPONSE: t("marketData.failure.malformedResponse"),
    BINANCE_SYMBOL_MISSING: t("marketData.failure.symbolMissing"),
    BINANCE_SYMBOL_DUPLICATE: t("marketData.failure.symbolDuplicate"),
    BINANCE_SYMBOL_NOT_TRADING: t("marketData.failure.symbolNotTrading"),
    BINANCE_BASE_ASSET_MISMATCH: t("marketData.failure.baseAssetMismatch"),
    BINANCE_QUOTE_ASSET_MISMATCH: t("marketData.failure.quoteAssetMismatch"),
    BINANCE_SPOT_NOT_ALLOWED: t("marketData.failure.spotNotAllowed"),
    BINANCE_INVALID_PRICE: t("marketData.failure.invalidPrice"),
  };
  return `${failure.code} · ${labels[failure.code]}`;
}
