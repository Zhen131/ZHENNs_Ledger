import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  AssetFeedback,
  AssetOperation,
} from "./marketDataControlsTypes";
import type { LedgerData } from "@/core/models";
import { captureLedgerTime } from "@/core/shared";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { LedgerClock } from "@/core/shared";
import type { useLanguage } from "@/ui";
import { formatBinanceFailure } from "./marketDataControlsHelpers";
import type { BinanceRefreshSuccess } from "./binancePriceRefreshService";
import { getBinanceMappingSignature } from "./binanceMappingService";
import { mergeBinancePriceRefresh } from "./binancePriceRefreshService";

type CancelAssetOperationDeps = {
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  mountedRef: RefObject<boolean>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
};

export function doCancelAssetOperation(
  deps: CancelAssetOperationDeps,
  assetSymbol: string,
  resetFeedback: boolean,
) {
  const {
    assetOperationsRef,
    mountedRef,
    setAssetFeedback,
  } = deps;
      const operation = assetOperationsRef.current.get(assetSymbol);
      if (!operation) return;
      operation.controller.abort();
      assetOperationsRef.current.delete(assetSymbol);
      if (resetFeedback && mountedRef.current) {
        setAssetFeedback((current) => {
          const next = { ...current };
          delete next[assetSymbol];
          return next;
        });
      }
}

type FinishAssetOperationDeps = {
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  mountedRef: RefObject<boolean>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  setEditingAssetSymbol: Dispatch<SetStateAction<string | null>>;
};

export function doFinishAssetOperation(
  deps: FinishAssetOperationDeps,
  operation: AssetOperation,
  status: "saved" | "error",
  message: string,
) {
  const {
    assetOperationIsCurrent,
    assetOperationsRef,
    mountedRef,
    setAssetFeedback,
    setEditingAssetSymbol,
  } = deps;
    if (!assetOperationIsCurrent(operation)) return;
    assetOperationsRef.current.delete(operation.assetSymbol);
    if (!mountedRef.current) return;
    setAssetFeedback((current) => ({
      ...current,
      [operation.assetSymbol]: { status, message },
    }));
    if (status === "saved" && operation.kind === "save-mapping") {
      setEditingAssetSymbol(null);
    }
}

type FetchAndPersistAssetPriceDeps = {
  applyLedgerMutation: (mutation: (current: LedgerData) => LedgerData, timeSnapshot?: ReturnType<typeof captureLedgerTime>) => ApplyLedgerActionResult;
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  client: BinanceMarketDataClient;
  clock: LedgerClock;
  finishAssetOperation: (operation: AssetOperation, status: "saved" | "error", message: string) => void;
  generateId: () => string;
  latestRef: RefObject<{ ledgerData: LedgerData; ledgerEpoch: number; sessionGeneration: number; mutationVersion: number; persistedVersion: number; persistenceStatus: PersistenceStatus; isWritable: boolean; mappingSignature: string; }>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doFetchAndPersistAssetPrice(
  deps: FetchAndPersistAssetPriceDeps,
  operation: AssetOperation,
) {
  const {
    applyLedgerMutation,
    assetOperationIsCurrent,
    client,
    clock,
    finishAssetOperation,
    generateId,
    latestRef,
    setAssetFeedback,
    t,
  } = deps;
    if (!operation.mapping || !assetOperationIsCurrent(operation)) return;
    operation.phase = "fetching-price";
    const ticker = await client.fetchLatestPrices(
      [operation.mapping.symbol],
      operation.controller.signal,
    );
    if (!assetOperationIsCurrent(operation)) return;

    const price = ticker.prices.find(
      (candidate) => candidate.symbol === operation.mapping?.symbol,
    );
    const failure = ticker.failures.find(
      (candidate) => candidate.symbol === operation.mapping?.symbol,
    );
    if (!price || failure) {
      const detail = formatBinanceFailure(
        failure ?? {
          code: "BINANCE_SYMBOL_MISSING",
          symbol: operation.mapping.symbol,
          message: "Ticker response omitted the requested symbol",
        },
        t,
      );
      finishAssetOperation(
        operation,
        "error",
        operation.kind === "save-mapping"
          ? `${t("marketData.assetFeedback.mappingSavedPriceFailedPrefix")}${detail}`
          : `${t("marketData.assetFeedback.refreshFailedPrefix")}${detail}`,
      );
      return;
    }

    const acceptedTime = captureLedgerTime(clock);
    const success: BinanceRefreshSuccess = {
      assetSymbol: operation.assetSymbol,
      mapping: operation.mapping,
      price: price.price,
      recordedAt: acceptedTime.todayKey,
      fetchedAt: acceptedTime.now.toISOString(),
    };
    let appliedCount = 0;
    const expectedVersion = latestRef.current.mutationVersion + 1;
    const mutationResult = applyLedgerMutation(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.expectedMappingSignature
        ) {
          return current;
        }
        const merged = mergeBinancePriceRefresh(current, [success], generateId);
        appliedCount = merged.appliedAssetSymbols.length;
        return merged.ledgerData;
      },
      acceptedTime,
    );
    if (!assetOperationIsCurrent(operation)) return;
    if (mutationResult === "applied" && appliedCount === 1) {
      operation.phase = "saving-price";
      operation.expectedPersistedVersion = expectedVersion;
      setAssetFeedback((current) => ({
        ...current,
        [operation.assetSymbol]: {
          status: "saving-price",
          message:
            operation.kind === "save-mapping"
              ? t("marketData.assetFeedback.mappingSavedSavingPrice")
              : t("marketData.assetFeedback.savingAssetPrice"),
        },
      }));
      return;
    }
    finishAssetOperation(
      operation,
      "error",
      operation.kind === "save-mapping"
        ? t("marketData.assetFeedback.mappingSavedPriceNotWritten")
        : t("marketData.assetFeedback.priceNotWritten"),
    );
}
