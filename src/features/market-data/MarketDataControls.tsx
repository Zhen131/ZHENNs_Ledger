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
import {
  captureLedgerTime,
  isZero,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import {
  getPositionsFromLedger,
} from "@/features/portfolio";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import { type ConfirmDeleteOutcome, useLanguage } from "@/ui";
import {
  getBinanceMappingSignature,
} from "./binanceMappingService";
import { MappingRow } from "./MappingRow";
import {
  createInitialRefreshState,
  isAssetOperationContextCurrent,
  isGlobalOperationContextCurrent,
  createMappingDrafts,
} from "./marketDataControlsHelpers";
import type {
  AssetOperationKind,
  AssetOperation,
  AssetFeedback,
  GlobalRefreshState,
  GlobalOperation,
} from "./marketDataControlsTypes";
import {
  doCancelAssetOperation,
  doCreateAssetOperation,
  doFetchAndPersistAssetPrice,
  doFinishAssetOperation,
  doRefreshAsset,
  doRemoveMapping,
  doSaveMapping,
} from "./marketDataControlsAssetActions";
import {
  doFinishGlobalOperation,
  doRefreshNonZeroHoldings,
} from "./marketDataControlsGlobalRefresh";
import {
  runMappingDraftSyncEffect,
  runMarketDataMountEffect,
  runOperationInvalidationEffect,
  runPersistenceProgressEffect,
} from "./marketDataControlsEffects";
import { MarketDataControlsRefreshBar } from "./MarketDataControlsRefreshBar";
import { MarketDataControlsHoldingsList } from "./MarketDataControlsHoldingsList";

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
    return runMappingDraftSyncEffect(
      {
        assets,
        editingAssetSymbol,
        setMappingDrafts,
      },
    );
  }, [assets, editingAssetSymbol]);

  useEffect(() => {
    return runOperationInvalidationEffect(
      {
        assetOperationIsCurrent,
        assetOperationsRef,
        globalOperationIsCurrent,
        globalOperationRef,
        setAssetFeedback,
        setRefreshState,
        t,
      },
    );
  }, [
    assetIdentitySignature,
    isWritable,
    ledgerEpoch,
    mappingSignature,
    sessionGeneration,
    t,
  ]);

  useEffect(() => {
    return runPersistenceProgressEffect(
      {
        assetOperationIsCurrent,
        assetOperationsRef,
        fetchAndPersistAssetPrice,
        finishAssetOperation,
        finishGlobalOperation,
        globalOperationIsCurrent,
        globalOperationRef,
        mutationVersion,
        persistedVersion,
        persistenceStatus,
        setAssetFeedback,
        setRefreshState,
        t,
      },
    );
    // Operations are ref-owned tokens. Only persisted-version transitions may
    // advance them; render-local callback identities must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingSignature, mutationVersion, persistedVersion, persistenceStatus, t]);

  useEffect(() => {
    return runMarketDataMountEffect(
      {
        assetOperationsRef,
        globalOperationRef,
        mountedRef,
      },
    );
  }, []);

  function finishAssetOperation(
    operation: AssetOperation,
    status: "saved" | "error",
    message: string,
  ) {
    return doFinishAssetOperation(
      {
        assetOperationIsCurrent,
        assetOperationsRef,
        mountedRef,
        setAssetFeedback,
        setEditingAssetSymbol,
      },
      operation,
      status,
      message,
    );
  }

  async function fetchAndPersistAssetPrice(operation: AssetOperation) {
    return doFetchAndPersistAssetPrice(
      {
        applyLedgerMutation,
        assetOperationIsCurrent,
        client,
        clock,
        finishAssetOperation,
        generateId,
        latestRef,
        setAssetFeedback,
        t,
      },
      operation,
    );
  }

  function createAssetOperation(
    asset: Asset,
    kind: AssetOperationKind,
    mapping: BinanceMarketMapping | null,
  ): AssetOperation | null {
    return doCreateAssetOperation(
      {
        assetOperationsRef,
        cancelAssetOperation,
        cancelGlobalOperation,
        latestRef,
        operationSequenceRef,
        setAssetFeedback,
        t,
      },
      asset,
      kind,
      mapping,
    );
  }

  async function saveMapping(asset: Asset) {
    return doSaveMapping(
      {
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
      },
      asset,
    );
  }

  async function refreshAsset(asset: Asset) {
    return doRefreshAsset(
      {
        assetOperationIsCurrent,
        client,
        createAssetOperation,
        fetchAndPersistAssetPrice,
        finishAssetOperation,
        setAssetFeedback,
        t,
      },
      asset,
    );
  }

  async function refreshNonZeroHoldings() {
    return doRefreshNonZeroHoldings(
      {
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
      },
    );
  }

  function finishGlobalOperation(operation: GlobalOperation) {
    return doFinishGlobalOperation(
      {
        globalOperationIsCurrent,
        globalOperationRef,
        mountedRef,
        setRefreshState,
        t,
      },
      operation,
    );
  }

  function removeMapping(asset: Asset): ConfirmDeleteOutcome {
    return doRemoveMapping(
      {
        applyLedgerMutation,
        cancelAssetOperation,
        cancelGlobalOperation,
        clock,
        isWritable,
        setAssetFeedback,
        setEditingAssetSymbol,
        setMappingDrafts,
        t,
      },
      asset,
    );
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
        <MarketDataControlsRefreshBar
          anyAssetOperation={anyAssetOperation}
          globalBusy={globalBusy}
          hasRefreshableHolding={hasRefreshableHolding}
          isWritable={isWritable}
          mode={mode}
          onModeChange={onModeChange}
          refreshNonZeroHoldings={refreshNonZeroHoldings}
          refreshState={refreshState}
          t={t}
        />
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
        <MarketDataControlsHoldingsList
          activeTodayKey={activeTodayKey}
          currentPositions={currentPositions}
          ledgerData={ledgerData}
          mode={mode}
          refreshState={refreshState}
          t={t}
        />
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
