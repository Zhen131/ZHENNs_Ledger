import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  AssetFeedback,
  AssetOperation,
  AssetOperationKind,
} from "./marketDataControlsTypes";
import type {
  Asset,
  BinanceMarketMapping,
  LedgerData,
} from "@/core/models";
import { captureLedgerTime } from "@/core/shared";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { LedgerClock } from "@/core/shared";
import type {
  ConfirmDeleteOutcome,
  useLanguage,
} from "@/ui";
import { formatBinanceFailure } from "./marketDataControlsHelpers";
import type { BinanceRefreshSuccess } from "./binancePriceRefreshService";
import {
  getBinanceMappingSignature,
  setAssetBinanceMapping,
  validateBinanceMapping,
} from "./binanceMappingService";
import { mergeBinancePriceRefresh } from "./binancePriceRefreshService";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";

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

type CreateAssetOperationDeps = {
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  cancelAssetOperation: (assetSymbol: string, resetFeedback: boolean) => void;
  cancelGlobalOperation: (resetFeedback: boolean) => void;
  latestRef: RefObject<{ ledgerData: LedgerData; ledgerEpoch: number; sessionGeneration: number; mutationVersion: number; persistedVersion: number; persistenceStatus: PersistenceStatus; isWritable: boolean; mappingSignature: string; }>;
  operationSequenceRef: RefObject<number>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doCreateAssetOperation(
  deps: CreateAssetOperationDeps,
  asset: Asset,
  kind: AssetOperationKind,
  mapping: BinanceMarketMapping | null,
): AssetOperation | null {
  const {
    assetOperationsRef,
    cancelAssetOperation,
    cancelGlobalOperation,
    latestRef,
    operationSequenceRef,
    setAssetFeedback,
    t,
  } = deps;
    if (!latestRef.current.isWritable) return null;
    cancelGlobalOperation(true);
    cancelAssetOperation(asset.symbol, false);
    const operation: AssetOperation = {
      id: ++operationSequenceRef.current,
      kind,
      phase: "validating",
      controller: new AbortController(),
      ledgerEpoch: latestRef.current.ledgerEpoch,
      sessionGeneration: latestRef.current.sessionGeneration,
      assetId: asset.id,
      assetSymbol: asset.symbol,
      startMappingSignature: latestRef.current.mappingSignature,
      expectedMappingSignature: latestRef.current.mappingSignature,
      mapping,
      expectedPersistedVersion: null,
    };
    assetOperationsRef.current.set(asset.symbol, operation);
    setAssetFeedback((current) => ({
      ...current,
      [asset.symbol]: {
        status: "validating",
        message:
          kind === "save-mapping"
            ? t("marketData.assetFeedback.validatingMapping")
            : t("marketData.assetFeedback.validatingAndRefreshing"),
      },
    }));
    return operation;
}

type SaveMappingDeps = {
  applyLedgerMutation: (mutation: (current: LedgerData) => LedgerData, timeSnapshot?: ReturnType<typeof captureLedgerTime>) => ApplyLedgerActionResult;
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  client: BinanceMarketDataClient;
  clock: LedgerClock;
  createAssetOperation: (asset: Asset, kind: AssetOperationKind, mapping: BinanceMarketMapping | null) => AssetOperation | null;
  fetchAndPersistAssetPrice: (operation: AssetOperation) => Promise<void>;
  finishAssetOperation: (operation: AssetOperation, status: "saved" | "error", message: string) => void;
  latestRef: RefObject<{ ledgerData: LedgerData; ledgerEpoch: number; sessionGeneration: number; mutationVersion: number; persistedVersion: number; persistenceStatus: PersistenceStatus; isWritable: boolean; mappingSignature: string; }>;
  mappingDrafts: Record<string, string>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doSaveMapping(
  deps: SaveMappingDeps,
  asset: Asset,
) {
  const {
    applyLedgerMutation,
    assetOperationIsCurrent,
    assetOperationsRef,
    client,
    clock,
    createAssetOperation,
    fetchAndPersistAssetPrice,
    finishAssetOperation,
    latestRef,
    mappingDrafts,
    setAssetFeedback,
    t,
  } = deps;
    const operation = createAssetOperation(asset, "save-mapping", null);
    if (!operation) return;
    const result = await validateBinanceMapping(
      client,
      asset.symbol,
      mappingDrafts[asset.symbol] ?? "",
      operation.controller.signal,
    );
    if (!assetOperationIsCurrent(operation)) return;
    if (!result.ok) {
      finishAssetOperation(
        operation,
        "error",
        formatBinanceFailure(result.error, t),
      );
      return;
    }

    const timeSnapshot = captureLedgerTime(clock);
    let expectedSignature = operation.startMappingSignature;
    let mappingGuardAccepted = false;
    const expectedVersion = latestRef.current.mutationVersion + 1;
    const mutationResult = applyLedgerMutation(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.startMappingSignature
        ) {
          return current;
        }
        mappingGuardAccepted = true;
        const candidate = setAssetBinanceMapping(
          current,
          asset.symbol,
          result.mapping,
          timeSnapshot.now.toISOString(),
        );
        expectedSignature = getBinanceMappingSignature(candidate);
        return candidate;
      },
      timeSnapshot,
    );
    if (!assetOperationIsCurrent(operation)) return;
    if (!mappingGuardAccepted) {
      operation.controller.abort();
      assetOperationsRef.current.delete(operation.assetSymbol);
      return;
    }
    operation.mapping = result.mapping;
    operation.expectedMappingSignature = expectedSignature;

    if (mutationResult === "applied") {
      operation.phase = "saving-mapping";
      operation.expectedPersistedVersion = expectedVersion;
      setAssetFeedback((current) => ({
        ...current,
        [asset.symbol]: {
          status: "saving-mapping",
          message: t("marketData.assetFeedback.mappingValidatedSaving"),
        },
      }));
      return;
    }
    if (
      mutationResult === "noop" &&
      expectedSignature === operation.startMappingSignature
    ) {
      operation.phase = "fetching-price";
      setAssetFeedback((current) => ({
        ...current,
        [asset.symbol]: {
          status: "fetching-price",
          message: t("marketData.assetFeedback.mappingSavedFetching"),
        },
      }));
      void fetchAndPersistAssetPrice(operation);
      return;
    }
    finishAssetOperation(
      operation,
      "error",
      t("marketData.assetFeedback.ledgerNotWritable"),
    );
}

type RefreshAssetDeps = {
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  client: BinanceMarketDataClient;
  createAssetOperation: (asset: Asset, kind: AssetOperationKind, mapping: BinanceMarketMapping | null) => AssetOperation | null;
  fetchAndPersistAssetPrice: (operation: AssetOperation) => Promise<void>;
  finishAssetOperation: (operation: AssetOperation, status: "saved" | "error", message: string) => void;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doRefreshAsset(
  deps: RefreshAssetDeps,
  asset: Asset,
) {
  const {
    assetOperationIsCurrent,
    client,
    createAssetOperation,
    fetchAndPersistAssetPrice,
    finishAssetOperation,
    setAssetFeedback,
    t,
  } = deps;
    const mapping = resolveAssetBinanceMappingForRuntime(asset);
    if (!mapping) return;
    const operation = createAssetOperation(asset, "refresh-price", mapping);
    if (!operation) return;
    const validation = await client.validateSpotSymbol(
      asset.symbol,
      mapping.symbol,
      operation.controller.signal,
    );
    if (!assetOperationIsCurrent(operation)) return;
    if (!validation.ok) {
      finishAssetOperation(
        operation,
        "error",
        `${t("marketData.assetFeedback.refreshFailedPrefix")}${formatBinanceFailure(validation.error, t)}`,
      );
      return;
    }
    operation.phase = "fetching-price";
    setAssetFeedback((current) => ({
      ...current,
      [asset.symbol]: {
        status: "fetching-price",
        message: t("marketData.assetFeedback.mappingValidFetching"),
      },
    }));
    void fetchAndPersistAssetPrice(operation);
}

type RemoveMappingDeps = {
  applyLedgerMutation: (mutation: (current: LedgerData) => LedgerData, timeSnapshot?: ReturnType<typeof captureLedgerTime>) => ApplyLedgerActionResult;
  cancelAssetOperation: (assetSymbol: string, resetFeedback: boolean) => void;
  cancelGlobalOperation: (resetFeedback: boolean) => void;
  clock: LedgerClock;
  isWritable: boolean;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  setEditingAssetSymbol: Dispatch<SetStateAction<string | null>>;
  setMappingDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doRemoveMapping(
  deps: RemoveMappingDeps,
  asset: Asset,
): ConfirmDeleteOutcome {
  const {
    applyLedgerMutation,
    cancelAssetOperation,
    cancelGlobalOperation,
    clock,
    isWritable,
    setAssetFeedback,
    setEditingAssetSymbol,
    setMappingDrafts,
    t,
  } = deps;
    if (!isWritable) return "rejected";
    cancelGlobalOperation(true);
    cancelAssetOperation(asset.symbol, false);
    const timeSnapshot = captureLedgerTime(clock);
    const mutationResult = applyLedgerMutation(
      (current) =>
        setAssetBinanceMapping(
          current,
          asset.symbol,
          null,
          timeSnapshot.now.toISOString(),
        ),
      timeSnapshot,
    );
    if (mutationResult === "applied") {
      setEditingAssetSymbol(null);
      setMappingDrafts((current) => ({ ...current, [asset.symbol]: "" }));
    }
    setAssetFeedback((current) => ({
      ...current,
      [asset.symbol]: {
        status: mutationResult === "rejected" ? "error" : "saved",
        message:
          mutationResult === "applied"
            ? t("marketData.assetFeedback.mappingQueued")
            : mutationResult === "noop"
              ? t("marketData.assetFeedback.mappingUnchanged")
              : t("marketData.assetFeedback.mappingNotDeleted"),
      },
    }));
    return mutationResult;
}
