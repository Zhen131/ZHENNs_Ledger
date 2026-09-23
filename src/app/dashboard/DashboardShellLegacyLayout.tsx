"use client";

import { PriceForm } from "@/features/prices/ui";
import {
  TradeForm,
  TradeTable,
} from "@/features/trades/ui";
import { FeeRuleManager } from "@/features/fees/ui";
import { ChartsOverview } from "@/features/charts/ui";
import { MarketDataControls } from "@/features/market-data/ui";
import { Section } from "./Section";
import { DashboardShellPnlSummarySection } from "./DashboardShellPnlSummarySection";
import { DashboardShellAssetsSection } from "./DashboardShellAssetsSection";
import { DashboardShellDataManagementSection } from "./DashboardShellDataManagementSection";
import type { PersistentLedgerState } from "@/app/persistence";
import type { useLedgerWorkspaceSession } from "@/app/workspaces";
import type { DashboardDerivations } from "./dashboardDerivations";
import type {
  LedgerSession,
  LedgerSessionCapabilities,
  LedgerStorageKind,
} from "@/platform/persistence";
import type { LedgerClock } from "@/core/shared";
import type { ClearConfirmationMode } from "./DashboardShellTypes";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type {
  ConfirmDeleteOutcome,
  useLanguage,
} from "@/ui";

export function DashboardShellLegacyLayout({
  allocation,
  applyLedgerAction,
  applyLedgerMutation,
  cancelClearConfirmation,
  capabilities,
  chartRange,
  clearConfirmationError,
  clearConfirmationMode,
  clearConfirmationPhrase,
  clearConfirmationValue,
  clearSuccessMessage,
  clock,
  displayedTrades,
  handleClearLedger,
  handleDeleteTrade,
  heatmap,
  history,
  hydrationStatus,
  isDirty,
  isReadOnly,
  isWritable,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  openClearConfirmation,
  persistedVersion,
  persistenceOperation,
  persistenceStatus,
  pnlSummary,
  positions,
  replaceLedgerFromBackup,
  repositorySwitchBlocked,
  selectedTradeDate,
  session,
  setChartRange,
  setClearConfirmationError,
  setClearConfirmationValue,
  setSelectedTradeDate,
  setValuationPriceMode,
  storageKind,
  t,
  todayKey,
  tradeRemovalError,
  valuationPriceMode,
}: Readonly<{
  allocation: DashboardDerivations["allocation"];
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  applyLedgerMutation: PersistentLedgerState["applyLedgerMutation"];
  cancelClearConfirmation: () => void;
  capabilities: LedgerSessionCapabilities;
  chartRange: ReturnType<typeof useLedgerWorkspaceSession>["chartRange"];
  clearConfirmationError: string;
  clearConfirmationMode: ClearConfirmationMode | null;
  clearConfirmationPhrase: string;
  clearConfirmationValue: string;
  clearSuccessMessage: string;
  clock: LedgerClock;
  displayedTrades: PersistentLedgerState["ledgerData"]["trades"];
  handleClearLedger: () => Promise<void>;
  handleDeleteTrade: (tradeId: string) => ConfirmDeleteOutcome;
  heatmap: DashboardDerivations["heatmap"];
  history: DashboardDerivations["history"];
  hydrationStatus: PersistentLedgerState["hydrationStatus"];
  isDirty: PersistentLedgerState["isDirty"];
  isReadOnly: PersistentLedgerState["isReadOnly"];
  isWritable: boolean;
  ledgerData: PersistentLedgerState["ledgerData"];
  ledgerEpoch: PersistentLedgerState["ledgerEpoch"];
  mutationVersion: PersistentLedgerState["mutationVersion"];
  openClearConfirmation: (mode: ClearConfirmationMode) => void;
  persistedVersion: PersistentLedgerState["persistedVersion"];
  persistenceOperation: PersistentLedgerState["persistenceOperation"];
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  pnlSummary: DashboardDerivations["pnlSummary"];
  positions: DashboardDerivations["projection"]["positions"];
  replaceLedgerFromBackup: PersistentLedgerState["replaceLedgerFromBackup"];
  repositorySwitchBlocked: PersistentLedgerState["repositorySwitchBlocked"];
  selectedTradeDate: string | null;
  session: LedgerSession | undefined;
  setChartRange: ReturnType<typeof useLedgerWorkspaceSession>["setChartRange"];
  setClearConfirmationError: Dispatch<SetStateAction<string>>;
  setClearConfirmationValue: Dispatch<SetStateAction<string>>;
  setSelectedTradeDate: Dispatch<SetStateAction<string | null>>;
  setValuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["setValuationPriceMode"];
  storageKind: LedgerStorageKind;
  t: ReturnType<typeof useLanguage>["t"];
  todayKey: PersistentLedgerState["todayKey"];
  tradeRemovalError: string;
  valuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["valuationPriceMode"];
}>) {
  return (
          <div className="grid gap-5">
            {session === undefined ? (
            <>
            <Section title={t("dashboard.section.chartAndMarketData")}>
              <MarketDataControls
                applyLedgerMutation={applyLedgerMutation}
                clock={clock}
                isWritable={session === undefined && isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mode={valuationPriceMode}
                mutationVersion={mutationVersion}
                onModeChange={setValuationPriceMode}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
                sessionGeneration={ledgerEpoch}
                todayKey={todayKey}
              />
            </Section>

            <Section title={t("dashboard.section.charts")}>
              <ChartsOverview
                allocation={allocation}
                heatmap={heatmap}
                history={history}
                onRangeChange={setChartRange}
                onSelectedTradeDateChange={setSelectedTradeDate}
                range={chartRange}
                selectedTradeDate={selectedTradeDate}
              />
            </Section>

            <DashboardShellPnlSummarySection
              pnlSummary={pnlSummary}
              t={t}
            />

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <DashboardShellAssetsSection
                positions={positions}
                t={t}
              />

              <Section title={t("dashboard.section.priceInput")}>
                <fieldset
                  className={
                    session === undefined && isWritable ? "" : "opacity-60"
                  }
                  disabled={session !== undefined || !isWritable}
                >
                  <PriceForm
                    clock={clock}
                    ledgerData={ledgerData}
                    ledgerEpoch={ledgerEpoch}
                    mutationVersion={mutationVersion}
                    onPriceSnapshotCreated={(priceSnapshot, timeSnapshot) =>
                      applyLedgerAction({
                        type: "priceSnapshot/add",
                        priceSnapshot,
                      }, timeSnapshot)
                    }
                    persistedVersion={persistedVersion}
                    persistenceStatus={persistenceStatus}
                  />
                </fieldset>
              </Section>
            </div>

            <Section title={t("dashboard.section.addTrade")}>
              <fieldset
                className={
                  session === undefined && isWritable ? "" : "opacity-60"
                }
                disabled={session !== undefined || !isWritable}
              >
                <TradeForm
                  clock={clock}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mutationVersion={mutationVersion}
                  onTradeCreated={(trade, timeSnapshot) =>
                    applyLedgerAction(
                      { type: "trade/add", trade },
                      timeSnapshot,
                    )
                  }
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                />
              </fieldset>
            </Section>

            <Section title={t("dashboard.section.feeRules")}>
              <FeeRuleManager
                clock={clock}
                isWritable={session === undefined && isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onAction={applyLedgerAction}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
            </Section>

            <Section
              title={
                selectedTradeDate
                  ? `${t("dashboard.section.tradeList")} · ${selectedTradeDate}`
                  : t("dashboard.section.tradeList")
              }
            >
              {tradeRemovalError ? (
                <p
                  aria-live="polite"
                  className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {tradeRemovalError}
                </p>
              ) : null}
              <TradeTable
                deleteDisabled={session !== undefined || !isWritable}
                onDelete={
                  hydrationStatus === "ready" ? handleDeleteTrade : undefined
                }
                trades={displayedTrades}
                todayKey={todayKey}
              />
            </Section>

            </>
            ) : null}

            <DashboardShellDataManagementSection
              applyLedgerMutation={applyLedgerMutation}
              cancelClearConfirmation={cancelClearConfirmation}
              capabilities={capabilities}
              clearConfirmationError={clearConfirmationError}
              clearConfirmationMode={clearConfirmationMode}
              clearConfirmationPhrase={clearConfirmationPhrase}
              clearConfirmationValue={clearConfirmationValue}
              clearSuccessMessage={clearSuccessMessage}
              clock={clock}
              handleClearLedger={handleClearLedger}
              hydrationStatus={hydrationStatus}
              isDirty={isDirty}
              isReadOnly={isReadOnly}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              openClearConfirmation={openClearConfirmation}
              persistedVersion={persistedVersion}
              persistenceOperation={persistenceOperation}
              persistenceStatus={persistenceStatus}
              replaceLedgerFromBackup={replaceLedgerFromBackup}
              repositorySwitchBlocked={repositorySwitchBlocked}
              setClearConfirmationError={setClearConfirmationError}
              setClearConfirmationValue={setClearConfirmationValue}
              storageKind={storageKind}
              t={t}
            />
          </div>
  );
}
