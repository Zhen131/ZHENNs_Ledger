/**
 * 这个文件放行情区的几个小函数。
 * 管初始提示、操作还算不算数、草稿、失败说明。
 * 按钮的处理在 `marketDataControlsAssetActions.ts` 和 `marketDataControlsGlobalRefresh.ts`。
 * 没有特别的决定。
 */
import type { Asset, LedgerData } from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import { type BinanceMarketDataFailure } from "@/platform/integrations";
import type {
  AssetOperation,
  GlobalRefreshState,
  GlobalOperation,
} from "./marketDataControlsTypes";
import type { Translate } from "@/ui";

/**
 * 这个函数给「刷新」那一块一个初始状态。
 * 空闲、默认提示、没有失败。
 */
export function createInitialRefreshState(t: Translate): GlobalRefreshState {
  return {
  status: "idle",
  message: t("marketData.refresh.initial"),
  failures: [],
  };
}

/**
 * 这个函数回答：这次单币操作还算数吗？
 * 要账本能写、没取消、没换账本、币还在。
 * 还要对应关系没被别处改过，才算数。
 */
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

/**
 * 这个函数回答：这次全局刷新还算数吗？
 * 账本能写、没取消、没换账本、对应关系没变，才算数。
 */
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

/**
 * 这个函数给每种币的交易对输入框准备初始值。
 * 已配的写交易对，没配的空着。
 */
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

/**
 * 这个函数把一条币安失败写成「代码 · 说明」。
 * 举例：超时 → 答「BINANCE_TIMEOUT · 」加上超时的说明。
 * 限流或 HTTP 错误时，说明后面带上状态码。
 */
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
