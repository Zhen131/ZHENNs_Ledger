import type { LedgerData } from "@/core/models";
import { captureLedgerTime } from "@/core/shared";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  AssetOperation,
  GlobalOperation,
  GlobalRefreshState,
} from "./marketDataControlsTypes";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { LedgerClock } from "@/core/shared";
import type { useLanguage } from "@/ui";
import {
  mergeBinancePriceRefresh,
  refreshBinancePrices,
} from "./binancePriceRefreshService";
import { getBinanceMappingSignature } from "./binanceMappingService";

type RefreshNonZeroHoldingsDeps = {
  activeTodayKey: string;
  applyLedgerMutation: (mutation: (current: LedgerData) => LedgerData, timeSnapshot?: ReturnType<typeof captureLedgerTime>) => ApplyLedgerActionResult;
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  cancelAssetOperation: (assetSymbol: string, resetFeedback: boolean) => void;
  client: BinanceMarketDataClient;
  clock: LedgerClock;
  finishGlobalOperation: (operation: GlobalOperation) => void;
  generateId: () => string;
  globalOperationIsCurrent: (operation: GlobalOperation) => boolean;
  globalOperationRef: RefObject<GlobalOperation | null>;
  latestRef: RefObject<{ ledgerData: LedgerData; ledgerEpoch: number; sessionGeneration: number; mutationVersion: number; persistedVersion: number; persistenceStatus: PersistenceStatus; isWritable: boolean; mappingSignature: string; }>;
  operationSequenceRef: RefObject<number>;
  setRefreshState: Dispatch<SetStateAction<GlobalRefreshState>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doRefreshNonZeroHoldings(
  deps: RefreshNonZeroHoldingsDeps,
) {
  const {
    activeTodayKey,
    applyLedgerMutation,
    assetOperationsRef,
    cancelAssetOperation,
    client,
    clock,
    finishGlobalOperation,
    generateId,
    globalOperationIsCurrent,
    globalOperationRef,
    latestRef,
    operationSequenceRef,
    setRefreshState,
    t,
  } = deps;
    if (!latestRef.current.isWritable || globalOperationRef.current) return;
    for (const symbol of Array.from(assetOperationsRef.current.keys())) {
      cancelAssetOperation(symbol, true);
    }
    const operation: GlobalOperation = {
      id: ++operationSequenceRef.current,
      controller: new AbortController(),
      ledgerEpoch: latestRef.current.ledgerEpoch,
      sessionGeneration: latestRef.current.sessionGeneration,
      mappingSignature: latestRef.current.mappingSignature,
      expectedPersistedVersion: null,
      appliedCount: 0,
      failures: [],
    };
    globalOperationRef.current = operation;
    setRefreshState({
      status: "loading",
      message: t("marketData.refresh.validating"),
      failures: [],
    });
    const result = await refreshBinancePrices(
      latestRef.current.ledgerData,
      activeTodayKey,
      { client, clock },
      operation.controller.signal,
    );
    if (!globalOperationIsCurrent(operation)) return;
    operation.failures = result.failures;
    let appliedCount = 0;
    let mergeGuardAccepted = result.successes.length === 0;
    const expectedVersion = latestRef.current.mutationVersion + 1;
    const acceptedTime = result.successes[0]
      ? {
          now: new Date(result.successes[0].fetchedAt),
          todayKey: result.successes[0].recordedAt,
        }
      : undefined;
    const mutationResult =
      result.successes.length === 0
        ? "noop"
        : applyLedgerMutation(
            (current) => {
              if (
                getBinanceMappingSignature(current) !==
                operation.mappingSignature
              ) {
                return current;
              }
              mergeGuardAccepted = true;
              const merged = mergeBinancePriceRefresh(
                current,
                result.successes,
                generateId,
              );
              appliedCount = merged.appliedAssetSymbols.length;
              return merged.ledgerData;
            },
            acceptedTime,
          );
    if (!globalOperationIsCurrent(operation)) return;
    if (!mergeGuardAccepted) {
      operation.controller.abort();
      globalOperationRef.current = null;
      return;
    }
    operation.appliedCount = appliedCount;
    if (mutationResult === "applied" && appliedCount > 0) {
      operation.expectedPersistedVersion = expectedVersion;
      setRefreshState({
        status: "saving",
        message: `${t("marketData.refresh.fetchedPrefix")}${appliedCount}${t("marketData.refresh.fetchedSuffix")}`,
        failures: result.failures,
      });
      return;
    }
    finishGlobalOperation(operation);
}

type FinishGlobalOperationDeps = {
  globalOperationIsCurrent: (operation: GlobalOperation) => boolean;
  globalOperationRef: RefObject<GlobalOperation | null>;
  mountedRef: RefObject<boolean>;
  setRefreshState: Dispatch<SetStateAction<GlobalRefreshState>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doFinishGlobalOperation(
  deps: FinishGlobalOperationDeps,
  operation: GlobalOperation,
) {
  const {
    globalOperationIsCurrent,
    globalOperationRef,
    mountedRef,
    setRefreshState,
    t,
  } = deps;
    if (!globalOperationIsCurrent(operation)) return;
    globalOperationRef.current = null;
    if (!mountedRef.current) return;
    const failedCount = operation.failures.length;
    setRefreshState({
      status:
        operation.appliedCount > 0
          ? failedCount > 0
            ? "partial"
            : "success"
          : failedCount > 0
            ? "error"
            : "success",
      message:
        operation.appliedCount === 0 && failedCount === 0
          ? t("marketData.refresh.noMappedNonZeroHoldings")
          : `${t("marketData.refresh.savedPrefix")}${operation.appliedCount}${t("marketData.refresh.savedMiddle")}${failedCount}${t("marketData.refresh.savedSuffix")}`,
      failures: operation.failures,
    });
}
