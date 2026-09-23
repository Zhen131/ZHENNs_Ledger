"use client";

import { AssetTransferPanel } from "@/features/asset-transfers/ui";
import { TradeForm } from "@/features/trades/ui";
import { CashEventPanel } from "@/features/cash/ui";
import { SurfaceCard } from "@/ui";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type { TradeWorkspaceDraft } from "@/features/trades";
import type {
  AssetTransfer,
  CashEvent,
  LedgerData,
  Trade,
} from "@/core/models";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app/persistence";
import type { RecordTarget } from "./workspaceDrafts";
import type { useLanguage } from "@/ui";
import type { RefObject } from "react";

export function RecordWorkspaceFactCard({
  cashBalance,
  clock,
  commitTradeDraft,
  isWritable,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  onAssetTransferCreated,
  onAssetTransferDeleted,
  onCashEventCreated,
  onCashEventDeleted,
  onTradeCreated,
  persistedVersion,
  persistenceStatus,
  recordTarget,
  resetTradeDraft,
  t,
  tradeDraft,
  tradeFocusRef,
  updateRecordTarget,
}: Readonly<{
  cashBalance: string | undefined;
  clock: LedgerClock;
  commitTradeDraft: (nextDraft: TradeWorkspaceDraft) => void;
  isWritable: boolean;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  onAssetTransferCreated: (assetTransfer: AssetTransfer, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  onAssetTransferDeleted: (assetTransferId: string, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  onCashEventCreated: (cashEvent: CashEvent, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  onCashEventDeleted: (cashEventId: string, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  onTradeCreated: (trade: Trade, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  recordTarget: RecordTarget;
  resetTradeDraft: (preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">) => void;
  t: ReturnType<typeof useLanguage>["t"];
  tradeDraft: TradeWorkspaceDraft;
  tradeFocusRef: RefObject<HTMLSelectElement | null>;
  updateRecordTarget: (recordTarget: RecordTarget) => void;
}>) {
  return (
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
  );
}
