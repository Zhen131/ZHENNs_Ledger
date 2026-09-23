"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Asset,
  BinanceMarketMapping,
  LedgerData,
  Position,
  ValuationPriceMode,
} from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import {
  captureLedgerTime,
  isZero,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import {
  getPositionsFromLedger,
  selectPriceAsOf,
} from "@/features/portfolio";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import { LedgerNumber, type ConfirmDeleteOutcome, useLanguage } from "@/ui";
import {
  getBinanceMappingSignature,
  setAssetBinanceMapping,
  validateBinanceMapping,
} from "./binanceMappingService";
import {
  mergeBinancePriceRefresh,
  refreshBinancePrices,
  type BinanceRefreshSuccess,
} from "./binancePriceRefreshService";
import { MappingRow } from "./MappingRow";
import {
  createInitialRefreshState,
  isAssetOperationContextCurrent,
  isGlobalOperationContextCurrent,
  createMappingDrafts,
  formatBinanceFailure,
} from "./marketDataControlsHelpers";
import type {
  AssetOperationKind,
  AssetOperation,
  AssetFeedback,
  GlobalRefreshState,
  GlobalOperation,
} from "./marketDataControlsTypes";
import { doCancelAssetOperation } from "./marketDataControlsAssetActions";

const defaultClient = createBinanceMarketDataClient();

type MarketDataControlsProps = {
  ledgerData: LedgerData;
  positions?: readonly Position[];
  ledgerEpoch: number;
  sessionGeneration?: number;
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: PersistenceStatus;
  todayKey?: string;
  isWritable: boolean;
  mode: ValuationPriceMode;
  onModeChange: (mode: ValuationPriceMode) => void;
  applyLedgerMutation: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: ReturnType<typeof captureLedgerTime>,
  ) => ApplyLedgerActionResult;
  client?: BinanceMarketDataClient;
  clock?: LedgerClock;
  generateId?: () => string;
  showMappings?: boolean;
  showRefresh?: boolean;
  expandMappings?: boolean;
  compactMappings?: boolean;
};

export function MarketDataControls({
  ledgerData,
  positions,
  ledgerEpoch,
  sessionGeneration = ledgerEpoch,
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved",
  todayKey,
  isWritable,
  mode,
  onModeChange,
  applyLedgerMutation,
  client = defaultClient,
  clock = systemLedgerClock,
  generateId = () => globalThis.crypto.randomUUID(),
  showMappings = true,
  showRefresh = true,
  expandMappings = false,
  compactMappings = false,
}: Readonly<MarketDataControlsProps>) {
  const { t } = useLanguage();
  const activeTodayKey = todayKey ?? captureLedgerTime(clock).todayKey;
  const assets = ledgerData.assets;
  const mappingSignature = getBinanceMappingSignature(ledgerData);
  const assetIdentitySignature = assets
    .map((asset) => `${asset.id}:${asset.symbol}`)
    .sort()
    .join("|");
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>(
    () => createMappingDrafts(assets),
  );
  const [assetFeedback, setAssetFeedback] = useState<
    Record<string, AssetFeedback>
  >({});
  const [editingAssetSymbol, setEditingAssetSymbol] = useState<string | null>(
    null,
  );
  const [refreshState, setRefreshState] = useState<GlobalRefreshState>(() =>
    createInitialRefreshState(t),
  );
  const mountedRef = useRef(true);
  const operationSequenceRef = useRef(0);
  const assetOperationsRef = useRef(new Map<string, AssetOperation>());
  const globalOperationRef = useRef<GlobalOperation | null>(null);
  const latestRef = useRef({
    ledgerData,
    ledgerEpoch,
    sessionGeneration,
    mutationVersion,
    persistedVersion,
    persistenceStatus,
    isWritable,
    mappingSignature,
  });
  latestRef.current = {
    ledgerData,
    ledgerEpoch,
    sessionGeneration,
    mutationVersion,
    persistedVersion,
    persistenceStatus,
    isWritable,
    mappingSignature,
  };

  const currentPositions = useMemo(
    () =>
      (
        positions ??
        getPositionsFromLedger(ledgerData, {
          todayKey: activeTodayKey,
          mode,
        })
      ).filter((position) => !isZero(position.quantity)),
    [activeTodayKey, ledgerData, mode, positions],
  );
  const hasRefreshableHolding = currentPositions.some((position) => {
    const asset = assets.find(
      (candidate) => candidate.symbol === position.assetSymbol,
    );
    return asset?.quoteCurrency === "USDT" && asset.binanceMapping !== null;
  });

  function assetOperationIsCurrent(operation: AssetOperation): boolean {
    return (
      assetOperationsRef.current.get(operation.assetSymbol) === operation &&
      isAssetOperationContextCurrent(operation, latestRef.current)
    );
  }

  function globalOperationIsCurrent(operation: GlobalOperation): boolean {
    return (
      globalOperationRef.current === operation &&
      isGlobalOperationContextCurrent(operation, latestRef.current)
    );
  }

  const cancelGlobalOperation = useCallback((resetFeedback: boolean) => {
    const operation = globalOperationRef.current;
    if (!operation) return;
    operation.controller.abort();
    globalOperationRef.current = null;
    if (resetFeedback && mountedRef.current) {
      setRefreshState(createInitialRefreshState(t));
    }
  }, [t]);

  const cancelAssetOperation = useCallback(
    (assetSymbol: string, resetFeedback: boolean) => {
      return doCancelAssetOperation(
        {
          assetOperationsRef,
          mountedRef,
          setAssetFeedback,
        },
        assetSymbol,
        resetFeedback,
      );
    },
    [],
  );

  useEffect(() => {
    setMappingDrafts((current) => {
      const next = createMappingDrafts(assets);
      for (const asset of assets) {
        if (
          editingAssetSymbol === asset.symbol &&
          current[asset.symbol] !== undefined
        ) {
          next[asset.symbol] = current[asset.symbol];
        }
      }
      return next;
    });
  }, [assets, editingAssetSymbol]);

  useEffect(() => {
    for (const [assetSymbol, operation] of assetOperationsRef.current) {
      if (!assetOperationIsCurrent(operation)) {
        operation.controller.abort();
        assetOperationsRef.current.delete(assetSymbol);
        setAssetFeedback((current) => {
          const next = { ...current };
          delete next[assetSymbol];
          return next;
        });
      }
    }
    const globalOperation = globalOperationRef.current;
    if (globalOperation && !globalOperationIsCurrent(globalOperation)) {
      globalOperation.controller.abort();
      globalOperationRef.current = null;
      setRefreshState(createInitialRefreshState(t));
    }
  }, [
    assetIdentitySignature,
    isWritable,
    ledgerEpoch,
    mappingSignature,
    sessionGeneration,
    t,
  ]);

  useEffect(() => {
    for (const operation of assetOperationsRef.current.values()) {
      if (!assetOperationIsCurrent(operation)) continue;
      if (
        operation.phase === "saving-mapping" &&
        operation.expectedPersistedVersion !== null
      ) {
        if (
          persistenceStatus === "error" &&
          mutationVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "error",
            t("marketData.assetFeedback.mappingNotPersisted"),
          );
          continue;
        }
        if (
          persistenceStatus === "saved" &&
          persistedVersion >= operation.expectedPersistedVersion
        ) {
          operation.phase = "fetching-price";
          operation.expectedPersistedVersion = null;
          setAssetFeedback((current) => ({
            ...current,
            [operation.assetSymbol]: {
              status: "fetching-price",
              message: t("marketData.assetFeedback.mappingSavedFetching"),
            },
          }));
          void fetchAndPersistAssetPrice(operation);
        }
      } else if (
        operation.phase === "saving-price" &&
        operation.expectedPersistedVersion !== null
      ) {
        if (
          persistenceStatus === "error" &&
          mutationVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "error",
            operation.kind === "save-mapping"
              ? t("marketData.assetFeedback.mappingSavedPriceNotPersisted")
              : t("marketData.assetFeedback.priceNotPersisted"),
          );
          continue;
        }
        if (
          persistenceStatus === "saved" &&
          persistedVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "saved",
            operation.kind === "save-mapping"
              ? t("marketData.assetFeedback.mappingAndPriceSaved")
              : t("marketData.assetFeedback.priceSaved"),
          );
        }
      }
    }

    const globalOperation = globalOperationRef.current;
    if (
      globalOperation &&
      globalOperation.expectedPersistedVersion !== null &&
      globalOperationIsCurrent(globalOperation)
    ) {
      if (
        persistenceStatus === "error" &&
        mutationVersion >= globalOperation.expectedPersistedVersion
      ) {
        globalOperation.controller.abort();
        globalOperationRef.current = null;
        setRefreshState({
          status: "error",
          message: t("marketData.assetFeedback.priceNotPersisted"),
          failures: globalOperation.failures,
        });
      } else if (
        persistenceStatus === "saved" &&
        persistedVersion >= globalOperation.expectedPersistedVersion
      ) {
        finishGlobalOperation(globalOperation);
      }
    }
    // Operations are ref-owned tokens. Only persisted-version transitions may
    // advance them; render-local callback identities must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingSignature, mutationVersion, persistedVersion, persistenceStatus, t]);

  useEffect(() => {
    mountedRef.current = true;
    const assetOperations = assetOperationsRef.current;
    return () => {
      mountedRef.current = false;
      for (const operation of assetOperations.values()) {
        operation.controller.abort();
      }
      assetOperations.clear();
      globalOperationRef.current?.controller.abort();
      globalOperationRef.current = null;
    };
  }, []);

  function finishAssetOperation(
    operation: AssetOperation,
    status: "saved" | "error",
    message: string,
  ) {
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

  async function fetchAndPersistAssetPrice(operation: AssetOperation) {
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

  function createAssetOperation(
    asset: Asset,
    kind: AssetOperationKind,
    mapping: BinanceMarketMapping | null,
  ): AssetOperation | null {
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

  async function saveMapping(asset: Asset) {
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

  async function refreshAsset(asset: Asset) {
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

  async function refreshNonZeroHoldings() {
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

  function finishGlobalOperation(operation: GlobalOperation) {
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

  function removeMapping(asset: Asset): ConfirmDeleteOutcome {
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

  const anyAssetOperation = assetOperationsRef.current.size > 0;
  const globalBusy =
    refreshState.status === "loading" || refreshState.status === "saving";

  return (
    <div className="grid gap-5">
      {!isWritable ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {t("marketData.readOnlyNotice")}
        </p>
      ) : null}

      {showRefresh ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("marketData.priceMode.label")}</span>
            {(["auto", "manual"] as const).map((value) => (
              <button
                aria-pressed={mode === value}
                className={
                  mode === value
                    ? "rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
                    : "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                }
                key={value}
                onClick={() => onModeChange(value)}
                type="button"
              >
                {value === "auto" ? t("marketData.priceMode.auto") : t("marketData.priceMode.manual")}
              </button>
            ))}
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !isWritable ||
                !hasRefreshableHolding ||
                globalBusy ||
                anyAssetOperation
              }
              onClick={() => void refreshNonZeroHoldings()}
              type="button"
            >
              {globalBusy
                ? t("marketData.refresh.updating")
                : t("marketData.refresh.action")}
            </button>
          </div>
          <p
            aria-live="polite"
            className={
              refreshState.status === "error"
                ? "text-sm text-red-800"
                : "text-sm text-slate-700"
            }
          >
            {refreshState.message}
          </p>
        </>
      ) : null}

      <div className="grid gap-2 text-sm text-slate-700">
        {showRefresh ? (
          <p>
            {t("marketData.description.usdt")}
          </p>
        ) : null}
        <p>
          {t("marketData.description.network")}
        </p>
      </div>

      {showRefresh ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t("marketData.holdings.heading")}</h3>
          {currentPositions.length === 0 ? (
            <p className="text-sm text-slate-500">{t("marketData.holdings.empty")}</p>
          ) : (
            <ul className="grid gap-1 text-sm text-slate-700">
              {currentPositions.map((position) => {
                const asset = ledgerData.assets.find(
                  (candidate) => candidate.symbol === position.assetSymbol,
                );
                const selected = asset
                  ? selectPriceAsOf(
                      ledgerData.priceSnapshots,
                      asset,
                      activeTodayKey,
                      mode,
                    )
                  : undefined;
                const failure = refreshState.failures.find(
                  (item) => item.assetSymbol === position.assetSymbol,
                );
                return (
                  <li key={position.assetSymbol}>
                    <strong>{position.assetSymbol}</strong>{t("marketData.holdings.colonSeparator")}
                    {selected ? (
                      <>
                        <LedgerNumber kind="money" value={selected.snapshot.price} />{" "}
                        {selected.snapshot.currency} · {selected.actualSource === "binance"
                          ? "Binance"
                          : t("marketData.holdings.manual")} · {t("marketData.holdings.asOf")} {selected.asOf}
                      </>
                    ) : t("marketData.holdings.noValidPrice")}
                    {failure
                      ? ` · ${t("marketData.holdings.refreshFailedPrefix")}${formatBinanceFailure(failure, t)}`
                      : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {showMappings ? (
        <details open={expandMappings}>
          <summary className="cursor-pointer font-semibold">
            {t("marketData.mappings.heading")}
          </summary>
          <div className="mt-3 min-w-0 overflow-x-auto">
            <div className="grid min-w-0 gap-3 md:min-w-[720px]">
              {compactMappings ? (
                <div className="hidden grid-cols-[7rem_1fr_1fr_auto] gap-3 px-3 text-xs font-semibold text-[var(--ledger-muted)] md:grid">
                  <span>{t("marketData.mappings.asset")}</span>
                  <span>{t("marketData.mappings.currentPair")}</span>
                  <span>{t("marketData.mappings.validationResult")}</span>
                  <span>{t("marketData.mappings.actions")}</span>
                </div>
              ) : null}
              {ledgerData.assets.map((asset) => (
                <MappingRow
                  asset={asset}
                  compact={compactMappings}
                  draft={mappingDrafts[asset.symbol] ?? ""}
                  editing={editingAssetSymbol === asset.symbol}
                  feedback={assetFeedback[asset.symbol]}
                  globalBusy={globalBusy}
                  isWritable={isWritable}
                  key={asset.id}
                  onCancel={() => setEditingAssetSymbol(null)}
                  onDelete={() => removeMapping(asset)}
                  onDraftChange={(value) =>
                    setMappingDrafts((current) => ({
                      ...current,
                      [asset.symbol]: value,
                    }))
                  }
                  onEdit={() => setEditingAssetSymbol(asset.symbol)}
                  onRefresh={() => void refreshAsset(asset)}
                  onSave={() => void saveMapping(asset)}
                  operationActive={assetOperationsRef.current.has(asset.symbol)}
                  t={t}
                />
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
