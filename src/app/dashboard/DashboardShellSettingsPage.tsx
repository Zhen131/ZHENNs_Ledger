"use client";

import {
  SettingsWorkspace,
  type useLedgerWorkspaceSession,
} from "@/app/workspaces";
import { FeeRuleManager } from "@/features/fees/ui";
import { MarketDataControls } from "@/features/market-data/ui";
import { LocalAssetManager } from "@/features/assets/ui";
import type { PersistentLedgerState } from "@/app/persistence";
import type { DashboardDerivations } from "./dashboardDerivations";
import type {
  LedgerSession,
  LedgerSessionCapabilities,
  LedgerStorageKind,
} from "@/platform/persistence";
import type { LedgerClock } from "@/core/shared";

export function DashboardShellSettingsPage({
  applyLedgerAction,
  applyLedgerMutation,
  capabilities,
  clock,
  handleSettingsClear,
  hydrationStatus,
  isReadOnly,
  isWritable,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceOperation,
  persistenceStatus,
  positions,
  repositorySwitchBlocked,
  session,
  setValuationPriceMode,
  storageKind,
  todayKey,
  valuationPriceMode,
}: Readonly<{
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  applyLedgerMutation: PersistentLedgerState["applyLedgerMutation"];
  capabilities: LedgerSessionCapabilities;
  clock: LedgerClock;
  handleSettingsClear: (mode: "normal" | "recovery") => Promise<boolean>;
  hydrationStatus: PersistentLedgerState["hydrationStatus"];
  isReadOnly: PersistentLedgerState["isReadOnly"];
  isWritable: boolean;
  ledgerData: PersistentLedgerState["ledgerData"];
  ledgerEpoch: PersistentLedgerState["ledgerEpoch"];
  mutationVersion: PersistentLedgerState["mutationVersion"];
  persistedVersion: PersistentLedgerState["persistedVersion"];
  persistenceOperation: PersistentLedgerState["persistenceOperation"];
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  positions: DashboardDerivations["projection"]["positions"];
  repositorySwitchBlocked: PersistentLedgerState["repositorySwitchBlocked"];
  session: LedgerSession;
  setValuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["setValuationPriceMode"];
  storageKind: LedgerStorageKind;
  todayKey: PersistentLedgerState["todayKey"];
  valuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["valuationPriceMode"];
}>) {
  return (
        <SettingsWorkspace
          active
          canClearHydrationError={capabilities.canClearHydrationError}
          canClearReadyLedger={capabilities.canClearReadyLedger}
          feePanel={
            <FeeRuleManager
              clock={clock}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              onAction={applyLedgerAction}
              persistedVersion={persistedVersion}
              persistenceStatus={persistenceStatus}
              presentation="settings"
            />
          }
          hydrationStatus={hydrationStatus}
          isReadOnly={isReadOnly}
          ledgerEpoch={ledgerEpoch}
          marketPanel={
            <div className="grid gap-6">
              <LocalAssetManager
                clock={clock}
                isWritable={isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onAssetCreated={(asset, timeSnapshot) =>
                  applyLedgerAction({ type: "asset/add", asset }, timeSnapshot)
                }
                onAssetDeleted={(assetSymbol, timeSnapshot) =>
                  applyLedgerAction(
                    { type: "asset/remove", assetSymbol },
                    timeSnapshot,
                  )
                }
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
              <div className="border-t border-[var(--ledger-border)] pt-5">
                <MarketDataControls
                  applyLedgerMutation={applyLedgerMutation}
                  clock={clock}
                  compactMappings
                  expandMappings
                  isWritable={isWritable}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mode={valuationPriceMode}
                  mutationVersion={mutationVersion}
                  onModeChange={setValuationPriceMode}
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                  positions={positions}
                  sessionGeneration={session.generation}
                  showRefresh={false}
                  todayKey={todayKey}
                />
              </div>
            </div>
          }
          onClear={handleSettingsClear}
          persistenceOperation={persistenceOperation}
          repositorySwitchBlocked={repositorySwitchBlocked}
          storageKind={storageKind}
        />
  );
}
