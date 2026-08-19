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
  type BinanceMarketDataFailure,
} from "@/platform/integrations";
import {
  ConfirmDeleteButton,
  type ConfirmDeleteOutcome,
} from "@/ui";
import {
  BINANCE_VALIDATION_UNAVAILABLE_USER_MESSAGE,
  getBinanceMappingSignature,
  setAssetBinanceMapping,
  validateBinanceMapping,
} from "./binanceMappingService";
import {
  mergeBinancePriceRefresh,
  refreshBinancePrices,
  type BinanceAssetRefreshFailure,
  type BinanceRefreshSuccess,
} from "./binancePriceRefreshService";

const defaultClient = createBinanceMarketDataClient();

type MarketDataControlsProps = {
  ledgerData: LedgerData;
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

type AssetOperationKind = "save-mapping" | "refresh-price";
type AssetOperationPhase =
  | "validating"
  | "saving-mapping"
  | "fetching-price"
  | "saving-price";
type AssetOperation = {
  id: number;
  kind: AssetOperationKind;
  phase: AssetOperationPhase;
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  assetId: string;
  assetSymbol: string;
  startMappingSignature: string;
  expectedMappingSignature: string;
  mapping: BinanceMarketMapping | null;
  expectedPersistedVersion: number | null;
};

type AssetOperationStatus =
  | "idle"
  | "validating"
  | "saving-mapping"
  | "fetching-price"
  | "saving-price"
  | "saved"
  | "error";
type AssetFeedback = {
  status: AssetOperationStatus;
  message: string;
};

type GlobalRefreshState = {
  status: "idle" | "loading" | "saving" | "success" | "partial" | "error";
  message: string;
  failures: BinanceAssetRefreshFailure[];
};
type GlobalOperation = {
  id: number;
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  mappingSignature: string;
  expectedPersistedVersion: number | null;
  appliedCount: number;
  failures: BinanceAssetRefreshFailure[];
};

const INITIAL_REFRESH_STATE: GlobalRefreshState = {
  status: "idle",
  message: "尚未主动刷新 Binance 行情。",
  failures: [],
};

export function MarketDataControls({
  ledgerData,
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
  const [refreshState, setRefreshState] =
    useState<GlobalRefreshState>(INITIAL_REFRESH_STATE);
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
      getPositionsFromLedger(ledgerData, {
        todayKey: activeTodayKey,
        mode,
      }).filter((position) => !isZero(position.quantity)),
    [activeTodayKey, ledgerData, mode],
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
      setRefreshState(INITIAL_REFRESH_STATE);
    }
  }, []);

  const cancelAssetOperation = useCallback(
    (assetSymbol: string, resetFeedback: boolean) => {
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
      setRefreshState(INITIAL_REFRESH_STATE);
    }
  }, [
    assetIdentitySignature,
    isWritable,
    ledgerEpoch,
    mappingSignature,
    sessionGeneration,
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
            "映射尚未保存到加密文件；未请求首次价格。",
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
              message: "映射已保存；正在获取首次价格。",
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
              ? "映射已保存；首次价格已进入内存，但尚未保存到加密文件。"
              : "行情已进入内存，但尚未保存到加密文件。",
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
              ? "映射与首次价格均已保存。"
              : "该资产行情已保存。",
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
          message: "行情已进入内存，但尚未保存到加密文件。",
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
  }, [mappingSignature, mutationVersion, persistedVersion, persistenceStatus]);

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
      );
      finishAssetOperation(
        operation,
        "error",
        operation.kind === "save-mapping"
          ? `映射已保存；首次价格失败：${detail}`
          : `该资产刷新失败：${detail}`,
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
              ? "映射已保存；正在保存首次价格。"
              : "正在保存该资产行情。",
        },
      }));
      return;
    }
    finishAssetOperation(
      operation,
      "error",
      operation.kind === "save-mapping"
        ? "映射已保存；首次价格未写入，旧价格保持不变。"
        : "该资产行情未写入，旧价格保持不变。",
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
            ? "正在向 Binance 验证交易对。"
            : "正在验证交易对并刷新该资产。",
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
        formatBinanceFailure(result.error),
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
          message: "交易对已验证；正在保存映射。",
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
          message: "映射已保存；正在获取首次价格。",
        },
      }));
      void fetchAndPersistAssetPrice(operation);
      return;
    }
    finishAssetOperation(
      operation,
      "error",
      "账本当前不可写或已变化，映射未保存。",
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
        `该资产刷新失败：${formatBinanceFailure(validation.error)}`,
      );
      return;
    }
    operation.phase = "fetching-price";
    setAssetFeedback((current) => ({
      ...current,
      [asset.symbol]: {
        status: "fetching-price",
        message: "交易对有效；正在获取该资产价格。",
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
      message: "正在验证并刷新已映射的非零持仓。",
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
        message: `已取得 ${appliedCount} 项行情；正在保存。`,
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
          ? "当前没有需要刷新的已映射非零持仓。"
          : `已保存 ${operation.appliedCount} 项，失败 ${failedCount} 项。`,
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
            ? "映射已进入保存队列；历史 API 价格仍保留。"
            : mutationResult === "noop"
              ? "映射未发生变化。"
              : "账本当前不可写，映射未删除。",
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
          暂不可修改：当前账本只读或文件操作尚未完成。
        </p>
      ) : null}

      {showRefresh ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">估值价格模式</span>
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
                {value === "auto" ? "自动行情" : "手动价格"}
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
                ? "正在更新 Binance 行情"
                : "刷新已映射非零持仓"}
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
            USDT 账本按 USDT 显示；旧 USD 数据只用于明确拒绝或兼容诊断，不会写入新的 Binance 价格事实。
          </p>
        ) : null}
        <p>
          只有点击验证或刷新按钮才会联网。请求只包含公开交易对 symbol，不会发送交易、数量、成本、密码或完整账本。
        </p>
      </div>

      {showRefresh ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">当前非零持仓实际价格</h3>
          {currentPositions.length === 0 ? (
            <p className="text-sm text-slate-500">当前没有非零持仓。</p>
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
                    <strong>{position.assetSymbol}</strong>：
                    {selected
                      ? `${selected.snapshot.price} ${selected.snapshot.currency} · ${
                          selected.actualSource === "binance"
                            ? "Binance"
                            : "手动"
                        } · 截至 ${selected.asOf}`
                      : "无合法价格"}
                    {failure
                      ? ` · 本次刷新失败：${formatBinanceFailure(failure)}`
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
            配置 Binance Spot 交易对
          </summary>
          <div className="mt-3 min-w-0 overflow-x-auto">
            <div className="grid min-w-0 gap-3 md:min-w-[720px]">
              {compactMappings ? (
                <div className="hidden grid-cols-[7rem_1fr_1fr_auto] gap-3 px-3 text-xs font-semibold text-[var(--ledger-muted)] md:grid">
                  <span>资产</span>
                  <span>当前交易对</span>
                  <span>验证 / 最近结果</span>
                  <span>操作</span>
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
                />
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function MappingRow({
  asset,
  compact,
  draft,
  editing,
  feedback,
  globalBusy,
  isWritable,
  operationActive,
  onCancel,
  onDelete,
  onDraftChange,
  onEdit,
  onRefresh,
  onSave,
}: Readonly<{
  asset: Asset;
  compact: boolean;
  draft: string;
  editing: boolean;
  feedback?: AssetFeedback;
  globalBusy: boolean;
  isWritable: boolean;
  operationActive: boolean;
  onCancel: () => void;
  onDelete: () => ConfirmDeleteOutcome;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onSave: () => void;
}>) {
  const currentMapping = resolveAssetBinanceMappingForRuntime(asset);
  const mayRestartValidation =
    operationActive && feedback?.status === "validating";
  const busy = (operationActive && !mayRestartValidation) || globalBusy;
  const input = (
    <input
      aria-label={`${asset.symbol} Binance 交易对`}
      className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
      disabled={!isWritable || busy}
      id={`mapping-${asset.id}`}
      onChange={(event) => onDraftChange(event.target.value)}
      placeholder={`${asset.symbol}USDT`}
      value={draft}
    />
  );
  const controls = (
    <>
      {editing || !compact ? (
        <button
          className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
          disabled={!isWritable || busy}
          onClick={onSave}
          type="button"
        >
          {feedback?.status === "saving-mapping"
              ? "正在保存映射"
              : feedback?.status === "fetching-price" ||
                  feedback?.status === "saving-price"
                ? "正在保存首次价格"
                : "验证并保存"}
        </button>
      ) : (
        <button
          className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
          disabled={!isWritable || busy}
          onClick={onEdit}
          type="button"
        >
          编辑
        </button>
      )}
      {editing && compact ? (
        <button
          className="rounded-md border border-slate-200 px-3 py-2 font-medium disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      ) : null}
      <button
        className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
        disabled={!isWritable || busy || currentMapping === null}
        onClick={onRefresh}
        type="button"
      >
        刷新该资产
      </button>
      <ConfirmDeleteButton
        ariaLabel={`删除 ${asset.symbol} Binance 映射`}
        disabled={!isWritable || busy || currentMapping === null}
        label="删除映射"
        onConfirm={onDelete}
      />
    </>
  );

  if (compact) {
    return (
      <div className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[7rem_1fr_1fr_auto] md:items-center">
        <p className="font-semibold">{asset.symbol}</p>
        <div className="grid gap-2">
          <p>{currentMapping?.symbol ?? "未配置"}</p>
          {editing ? input : null}
        </div>
        <div className="text-sm text-slate-600">
          <p>{currentMapping ? "已配置显式映射" : "尚未配置"}</p>
          {feedback ? (
            <p
              aria-live="polite"
              className={
                feedback.status === "error" ? "mt-1 text-red-800" : "mt-1"
              }
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">{controls}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[8rem_1fr_auto]">
      <label className="font-medium" htmlFor={`mapping-${asset.id}`}>
        {asset.symbol}
      </label>
      {input}
      <div className="flex flex-wrap gap-2">{controls}</div>
      {feedback ? (
        <p
          aria-live="polite"
          className={
            feedback.status === "error"
              ? "text-sm text-red-800 md:col-start-2 md:col-span-2"
              : "text-sm text-slate-600 md:col-start-2 md:col-span-2"
          }
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

function isAssetOperationContextCurrent(
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

function isGlobalOperationContextCurrent(
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

function createMappingDrafts(
  assets: readonly Asset[],
): Record<string, string> {
  return Object.fromEntries(
    assets.map((asset) => [
      asset.symbol,
      resolveAssetBinanceMappingForRuntime(asset)?.symbol ?? "",
    ]),
  );
}

function formatBinanceFailure(failure: BinanceMarketDataFailure): string {
  const labels: Record<BinanceMarketDataFailure["code"], string> = {
    BINANCE_INVALID_SYMBOL_INPUT: "输入只能是 1～64 位 ASCII 字母或数字",
    BINANCE_ABORTED: "请求已取消",
    BINANCE_TIMEOUT: "请求超时",
    BINANCE_VALIDATION_UNAVAILABLE:
      BINANCE_VALIDATION_UNAVAILABLE_USER_MESSAGE,
    BINANCE_NETWORK_ERROR: "网络不可用",
    BINANCE_HTTP_ERROR: `Binance HTTP 错误${failure.httpStatus ? ` ${failure.httpStatus}` : ""}`,
    BINANCE_RATE_LIMITED: `Binance 限流${failure.httpStatus ? ` ${failure.httpStatus}` : ""}`,
    BINANCE_MALFORMED_RESPONSE: "Binance 响应格式异常",
    BINANCE_SYMBOL_MISSING: "未找到该交易对",
    BINANCE_SYMBOL_DUPLICATE: "Binance 返回了重复交易对",
    BINANCE_SYMBOL_NOT_TRADING: "交易对当前不可交易",
    BINANCE_BASE_ASSET_MISMATCH: "基础资产与本地资产不一致",
    BINANCE_QUOTE_ASSET_MISMATCH: "报价资产不是 USDT",
    BINANCE_SPOT_NOT_ALLOWED: "交易对未开放 Spot",
    BINANCE_INVALID_PRICE: "价格不是有效正数",
  };
  return `${failure.code} · ${labels[failure.code]}`;
}
