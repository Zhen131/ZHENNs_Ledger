"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app/persistence";
import type {
  AssetTransfer,
  CashEvent,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import {
  captureLedgerTime,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { AssetTransferPanel } from "@/features/asset-transfers/ui";
import { TradeForm } from "@/features/trades/ui";
import { CashEventPanel } from "@/features/cash/ui";
import { SurfaceCard, useLanguage } from "@/ui";
import {
  createPriceWorkspaceDraft,
  type PriceWorkspaceDraft,
} from "@/features/prices";
import {
  createTradeWorkspaceDraft,
  type TradeWorkspaceDraft,
} from "@/features/trades";
import type { RecordTarget } from "./workspaceDrafts";
import { workspaceDraftsHaveUserInput } from "./workspaceDrafts";
import {
  doResetPriceDraft,
  doResetTradeDraft,
} from "./recordWorkspaceActions";
import { RecordWorkspacePriceSection } from "./RecordWorkspacePriceSection";

export function RecordWorkspace({
  active,
  focusIntent,
  onIntentConsumed,
  clock,
  cashBalance,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  isWritable,
  onDraftStatusChange,
  onTradeCreated,
  onCashEventCreated,
  onCashEventDeleted,
  onAssetTransferCreated,
  onAssetTransferDeleted,
  onPriceSnapshotCreated,
  marketDataPanel,
  recordTarget: controlledRecordTarget,
  onRecordTargetChange,
  initialTradeDraft,
  initialPriceDraft,
  onTradeDraftChange,
  onPriceDraftChange,
}: Readonly<{
  active: boolean;
  focusIntent: "trade" | "price" | null;
  onIntentConsumed: () => void;
  clock: LedgerClock;
  cashBalance?: string;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  isWritable: boolean;
  onDraftStatusChange: (hasDrafts: boolean) => void;
  onTradeCreated: (
    trade: Trade,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onCashEventCreated: (
    cashEvent: CashEvent,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onCashEventDeleted: (
    cashEventId: string,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onAssetTransferCreated: (
    assetTransfer: AssetTransfer,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onAssetTransferDeleted: (
    assetTransferId: string,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  marketDataPanel?: ReactNode;
  recordTarget?: RecordTarget;
  onRecordTargetChange?: (recordTarget: RecordTarget) => void;
  initialTradeDraft?: TradeWorkspaceDraft;
  initialPriceDraft?: PriceWorkspaceDraft;
  onTradeDraftChange?: (draft: TradeWorkspaceDraft) => void;
  onPriceDraftChange?: (draft: PriceWorkspaceDraft) => void;
}>) {
  const { t } = useLanguage();
  const tradeFocusRef = useRef<HTMLSelectElement>(null);
  const priceFocusRef = useRef<HTMLSelectElement>(null);
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const todayKey = captureLedgerTime(clock).todayKey;
  const [localRecordTarget, setRecordTarget] = useState<RecordTarget>({
    kind: "cash",
    currency: "USDT",
  });
  const [localTradeDraft, setTradeDraft] = useState<TradeWorkspaceDraft>(() =>
    createTradeWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
  );
  const [sessionTradeDraft, setSessionTradeDraft] =
    useState<TradeWorkspaceDraft>(() =>
      initialTradeDraft ??
      createTradeWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
    );
  const [localPriceDraft, setPriceDraft] = useState<PriceWorkspaceDraft>(() =>
    createPriceWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
  );
  const [sessionPriceDraft, setSessionPriceDraft] =
    useState<PriceWorkspaceDraft>(() =>
      initialPriceDraft ??
      createPriceWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
    );
  const recordTarget = controlledRecordTarget ?? localRecordTarget;
  const updateRecordTarget = onRecordTargetChange ?? setRecordTarget;
  const tradeDraft = initialTradeDraft ? sessionTradeDraft : localTradeDraft;
  const priceDraft = initialPriceDraft ? sessionPriceDraft : localPriceDraft;
  const updateTradeDraft = initialTradeDraft
    ? setSessionTradeDraft
    : setTradeDraft;
  const updatePriceDraft = initialPriceDraft
    ? setSessionPriceDraft
    : setPriceDraft;

  useEffect(() => {
    if (initialTradeDraft) setSessionTradeDraft(initialTradeDraft);
  }, [initialTradeDraft]);

  useEffect(() => {
    if (initialPriceDraft) setSessionPriceDraft(initialPriceDraft);
  }, [initialPriceDraft]);

  function commitTradeDraft(nextDraft: TradeWorkspaceDraft) {
    updateTradeDraft(nextDraft);
    onTradeDraftChange?.(nextDraft);
    onDraftStatusChange(
      workspaceDraftsHaveUserInput(nextDraft, priceDraft),
    );
  }

  function commitPriceDraft(nextDraft: PriceWorkspaceDraft) {
    updatePriceDraft(nextDraft);
    onPriceDraftChange?.(nextDraft);
    onDraftStatusChange(
      workspaceDraftsHaveUserInput(tradeDraft, nextDraft),
    );
  }

  function resetTradeDraft(
    preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">,
  ) {
    return doResetTradeDraft(
      {
        clock,
        onDraftStatusChange,
        onTradeDraftChange,
        priceDraft,
        todayKey,
        updateTradeDraft,
      },
      preserve,
    );
  }

  function resetPriceDraft(
    preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">,
  ) {
    return doResetPriceDraft(
      {
        clock,
        onDraftStatusChange,
        onPriceDraftChange,
        tradeDraft,
        updatePriceDraft,
      },
      preserve,
    );
  }

  useEffect(() => {
    setRecordTarget({ kind: "cash", currency: "USDT" });
    setTradeDraft(createTradeWorkspaceDraft(defaultAssetSymbol, todayKey, clock));
    setPriceDraft(createPriceWorkspaceDraft(defaultAssetSymbol, todayKey, clock));
    onDraftStatusChange(false);
    // A ledger epoch is the only event that clears session-local drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerEpoch]);

  useEffect(() => {
    if (
      recordTarget.kind === "trade" &&
      !ledgerData.assets.some(
        (asset) => asset.symbol === recordTarget.assetSymbol,
      )
    ) {
      updateRecordTarget({ kind: "cash", currency: "USDT" });
    }
  }, [ledgerData.assets, recordTarget, updateRecordTarget]);

  useEffect(() => {
    if (!active || focusIntent === null) return;
    if (focusIntent === "trade") {
      const assetSymbol = ledgerData.assets.some(
        (asset) => asset.symbol === tradeDraft.assetSymbol,
      )
        ? tradeDraft.assetSymbol
        : (ledgerData.assets[0]?.symbol ?? "");
      updateRecordTarget({ kind: "trade", assetSymbol });
    }
    const frame = requestAnimationFrame(() => {
      const target =
        focusIntent === "trade" ? tradeFocusRef.current : priceFocusRef.current;
      target?.focus();
      onIntentConsumed();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    active,
    focusIntent,
    ledgerData.assets,
    onIntentConsumed,
    updateRecordTarget,
    tradeDraft.assetSymbol,
  ]);

  return (
    <section
      aria-label={t("record.workspace.ariaLabel")}
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="record"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">{t("record.heading")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("record.description")}
        </p>
      </SurfaceCard>

      {!isWritable ? (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          {t("record.readOnlyNotice")}
        </p>
      ) : null}

      <SurfaceCard className="min-w-0 p-5">
        <label className="grid max-w-xl gap-2 text-sm font-medium">
          {t("record.target.label")}
          <select
            className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => {
              if (event.target.value === "cash:USDT") {
                updateRecordTarget({ kind: "cash", currency: "USDT" });
                return;
              }
              if (event.target.value === "asset-transfer") {
                updateRecordTarget({ kind: "asset-transfer" });
                return;
              }
              const assetSymbol = event.target.value.slice("trade:".length);
              updateRecordTarget({ kind: "trade", assetSymbol });
              commitTradeDraft({ ...tradeDraft, assetSymbol });
            }}
            value={
              recordTarget.kind === "cash"
                ? "cash:USDT"
                : recordTarget.kind === "asset-transfer"
                  ? "asset-transfer"
                  : `trade:${recordTarget.assetSymbol}`
            }
          >
            <option value="cash:USDT">{t("record.target.cash")}</option>
            <option value="asset-transfer">{t("record.target.assetTransfer")}</option>
            {ledgerData.assets.map((asset) => (
              <option key={asset.id} value={`trade:${asset.symbol}`}>
                {asset.symbol} · {asset.name}
              </option>
            ))}
          </select>
        </label>
      </SurfaceCard>

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-[minmax(0,1.35fr)_minmax(320px,.85fr)]">
        <SurfaceCard className="min-w-0 p-5">
          {recordTarget.kind === "cash" ? (
            <CashEventPanel
              cashBalance={cashBalance}
              clock={clock}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              onCashEventCreated={onCashEventCreated}
              onCashEventDeleted={onCashEventDeleted}
              persistedVersion={persistedVersion}
              persistenceStatus={persistenceStatus}
            />
          ) : recordTarget.kind === "asset-transfer" ? (
            <AssetTransferPanel
              clock={clock}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              onAssetTransferCreated={onAssetTransferCreated}
              onAssetTransferDeleted={onAssetTransferDeleted}
              persistedVersion={persistedVersion}
              persistenceStatus={persistenceStatus}
            />
          ) : (
            <>
              <div className="mb-4">
                <h3 className="font-semibold">
                  {t("record.trade.headingPrefix")}{recordTarget.assetSymbol}{t("record.trade.headingSuffix")}
                </h3>
                <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                  {t("record.trade.description")}
                </p>
              </div>
              <fieldset
                className={isWritable ? "" : "opacity-60"}
                disabled={!isWritable}
              >
                <TradeForm
                  clock={clock}
                  draft={{
                    ...tradeDraft,
                    assetSymbol: recordTarget.assetSymbol,
                  }}
                  focusTargetRef={tradeFocusRef}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mutationVersion={mutationVersion}
                  onDraftChange={(nextDraft) => {
                    if (
                      recordTarget.kind !== "trade" ||
                      recordTarget.assetSymbol !== nextDraft.assetSymbol
                    ) {
                      updateRecordTarget({
                        kind: "trade",
                        assetSymbol: nextDraft.assetSymbol,
                      });
                    }
                    commitTradeDraft(nextDraft);
                  }}
                  onReset={(preserve) => {
                    updateRecordTarget({
                      kind: "trade",
                      assetSymbol: preserve.assetSymbol,
                    });
                    resetTradeDraft(preserve);
                  }}
                  onTradeCreated={onTradeCreated}
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                />
              </fieldset>
            </>
          )}
        </SurfaceCard>

        <RecordWorkspacePriceSection
          clock={clock}
          commitPriceDraft={commitPriceDraft}
          isWritable={isWritable}
          ledgerData={ledgerData}
          ledgerEpoch={ledgerEpoch}
          marketDataPanel={marketDataPanel}
          mutationVersion={mutationVersion}
          onPriceSnapshotCreated={onPriceSnapshotCreated}
          persistedVersion={persistedVersion}
          persistenceStatus={persistenceStatus}
          priceDraft={priceDraft}
          priceFocusRef={priceFocusRef}
          resetPriceDraft={resetPriceDraft}
          t={t}
        />
      </div>
    </section>
  );
}
