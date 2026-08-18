"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "./usePersistentLedger";
import type { CashEvent, LedgerData, PriceSnapshot, Trade } from "@/core/models";
import type { LedgerClock, LedgerTimeSnapshot } from "@/core/shared";
import { PriceForm } from "@/features/prices/ui";
import { TradeForm } from "@/features/trades/ui";
import { CashEventPanel } from "@/features/cash/ui";
import { SurfaceCard } from "@/ui";
import type {
  PriceWorkspaceDraft,
  TradeWorkspaceDraft,
} from "./useLedgerWorkspaceSession";

type RecordTarget =
  | { kind: "cash"; currency: "USDT" }
  | { kind: "trade"; assetSymbol: string };

export function RecordWorkspace({
  active,
  focusIntent,
  onIntentConsumed,
  clock,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  isWritable,
  tradeDraft,
  onTradeDraftChange,
  onTradeReset,
  priceDraft,
  onPriceDraftChange,
  onPriceReset,
  onTradeCreated,
  onCashEventCreated,
  onCashEventDeleted,
  onPriceSnapshotCreated,
  marketDataPanel,
}: Readonly<{
  active: boolean;
  focusIntent: "trade" | "price" | null;
  onIntentConsumed: () => void;
  clock: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  isWritable: boolean;
  tradeDraft: TradeWorkspaceDraft;
  onTradeDraftChange: (draft: TradeWorkspaceDraft) => void;
  onTradeReset: (
    preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">,
  ) => void;
  priceDraft: PriceWorkspaceDraft;
  onPriceDraftChange: (draft: PriceWorkspaceDraft) => void;
  onPriceReset: (
    preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">,
  ) => void;
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
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  marketDataPanel?: ReactNode;
}>) {
  const tradeFocusRef = useRef<HTMLSelectElement>(null);
  const priceFocusRef = useRef<HTMLSelectElement>(null);
  const [recordTarget, setRecordTarget] = useState<RecordTarget>({
    kind: "cash",
    currency: "USDT",
  });

  useEffect(() => {
    setRecordTarget({ kind: "cash", currency: "USDT" });
  }, [ledgerEpoch]);

  useEffect(() => {
    if (
      recordTarget.kind === "trade" &&
      !ledgerData.assets.some(
        (asset) => asset.symbol === recordTarget.assetSymbol,
      )
    ) {
      setRecordTarget({ kind: "cash", currency: "USDT" });
    }
  }, [ledgerData.assets, recordTarget]);

  useEffect(() => {
    if (!active || focusIntent === null) return;
    if (focusIntent === "trade") {
      const assetSymbol = ledgerData.assets.some(
        (asset) => asset.symbol === tradeDraft.assetSymbol,
      )
        ? tradeDraft.assetSymbol
        : (ledgerData.assets[0]?.symbol ?? "");
      setRecordTarget({ kind: "trade", assetSymbol });
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
    tradeDraft.assetSymbol,
  ]);

  return (
    <section
      aria-label="记账工作区"
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="record"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">记录现金、交易与价格</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          先选择现金或某项本地资产；切换时会卸载另一张表单，不保留过期确认。
        </p>
      </SurfaceCard>

      {!isWritable ? (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          暂不可录入：当前账本只读或文件操作尚未完成，请查看顶部文件状态。
        </p>
      ) : null}

      <SurfaceCard className="min-w-0 p-5">
        <label className="grid max-w-xl gap-2 text-sm font-medium">
          记账对象
          <select
            className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => {
              if (event.target.value === "cash:USDT") {
                setRecordTarget({ kind: "cash", currency: "USDT" });
                return;
              }
              const assetSymbol = event.target.value.slice("trade:".length);
              setRecordTarget({ kind: "trade", assetSymbol });
              onTradeDraftChange({ ...tradeDraft, assetSymbol });
            }}
            value={
              recordTarget.kind === "cash"
                ? "cash:USDT"
                : `trade:${recordTarget.assetSymbol}`
            }
          >
            <option value="cash:USDT">现金 USDT</option>
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
          ) : (
            <>
              <div className="mb-4">
                <h3 className="font-semibold">
                  新增 {recordTarget.assetSymbol} 交易
                </h3>
                <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                  金额默认由数量 × 均价自动计算；手动改写后保持手动模式。
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
                    setRecordTarget({
                      kind: "trade",
                      assetSymbol: nextDraft.assetSymbol,
                    });
                    onTradeDraftChange(nextDraft);
                  }}
                  onReset={(preserve) => {
                    setRecordTarget({
                      kind: "trade",
                      assetSymbol: preserve.assetSymbol,
                    });
                    onTradeReset(preserve);
                  }}
                  onTradeCreated={onTradeCreated}
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                />
              </fieldset>
            </>
          )}
        </SurfaceCard>

        <div className="grid min-w-0 content-start gap-4">
          <SurfaceCard className="min-w-0 p-5">
            <div className="mb-4">
              <h3 className="font-semibold">更新当前价格</h3>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                手动价格只用于估值；资产与日期会在认证保存后保留。
              </p>
            </div>
            <fieldset
              className={isWritable ? "" : "opacity-60"}
              disabled={!isWritable}
            >
              <PriceForm
                clock={clock}
                draft={priceDraft}
                focusTargetRef={priceFocusRef}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onDraftChange={onPriceDraftChange}
                onPriceSnapshotCreated={onPriceSnapshotCreated}
                onReset={onPriceReset}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
            </fieldset>
          </SurfaceCard>

          {marketDataPanel ? (
            <SurfaceCard className="min-w-0 p-5">
              {marketDataPanel}
            </SurfaceCard>
          ) : null}
        </div>
      </div>
    </section>
  );
}
