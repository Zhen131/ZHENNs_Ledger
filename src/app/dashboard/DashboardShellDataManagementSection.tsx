"use client";

import { BackupControls } from "@/features/backup/ui";
import { Section } from "./Section";
import type { useLanguage } from "@/ui";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { PersistentLedgerState } from "@/app/persistence";
import type {
  LedgerSessionCapabilities,
  LedgerStorageKind,
} from "@/platform/persistence";
import type { LedgerClock } from "@/core/shared";
import type { ClearConfirmationMode } from "./DashboardShellTypes";

export function DashboardShellDataManagementSection({
  applyLedgerMutation,
  cancelClearConfirmation,
  capabilities,
  clearConfirmationError,
  clearConfirmationMode,
  clearConfirmationPhrase,
  clearConfirmationValue,
  clearSuccessMessage,
  clock,
  handleClearLedger,
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
  replaceLedgerFromBackup,
  repositorySwitchBlocked,
  setClearConfirmationError,
  setClearConfirmationValue,
  storageKind,
  t,
}: Readonly<{
  applyLedgerMutation: PersistentLedgerState["applyLedgerMutation"];
  cancelClearConfirmation: () => void;
  capabilities: LedgerSessionCapabilities;
  clearConfirmationError: string;
  clearConfirmationMode: ClearConfirmationMode | null;
  clearConfirmationPhrase: string;
  clearConfirmationValue: string;
  clearSuccessMessage: string;
  clock: LedgerClock;
  handleClearLedger: () => Promise<void>;
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
  replaceLedgerFromBackup: PersistentLedgerState["replaceLedgerFromBackup"];
  repositorySwitchBlocked: PersistentLedgerState["repositorySwitchBlocked"];
  setClearConfirmationError: Dispatch<SetStateAction<string>>;
  setClearConfirmationValue: Dispatch<SetStateAction<string>>;
  storageKind: LedgerStorageKind;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
            <Section title={t("dashboard.section.dataManagement")}>
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  {storageKind === "ledger-file"
                    ? t("dashboard.dataManagement.fileDescription")
                    : t("dashboard.dataManagement.legacyDescription")}
                </p>

                <BackupControls
                  applyLedgerMutation={applyLedgerMutation}
                  canImportBackup={capabilities.canImportBackup}
                  clock={clock}
                  hydrationStatus={hydrationStatus}
                  isDirty={isDirty}
                  isReadOnly={isReadOnly}
                  isWritable={isWritable}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mutationVersion={mutationVersion}
                  onImport={replaceLedgerFromBackup}
                  persistenceOperation={persistenceOperation}
                  persistenceStatus={persistenceStatus}
                  persistedVersion={persistedVersion}
                  sessionGeneration={ledgerEpoch}
                />

                {(capabilities.canClearReadyLedger ||
                  capabilities.canClearHydrationError) &&
                hydrationStatus === "loading" ? (
                  <p aria-live="polite">{t("dashboard.dataManagement.clearUnavailable")}</p>
                ) : null}

                {capabilities.canClearReadyLedger &&
                hydrationStatus === "ready" ? (
                  <button
                    className="w-fit rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      persistenceOperation !== "idle" ||
                      repositorySwitchBlocked ||
                      isReadOnly
                    }
                    onClick={() => openClearConfirmation("normal")}
                    type="button"
                  >
                    {storageKind === "ledger-file"
                      ? t("dashboard.dataManagement.clearFile")
                      : t("dashboard.dataManagement.clearLegacy")}
                  </button>
                ) : null}

                {capabilities.canClearHydrationError &&
                hydrationStatus === "error" ? (
                  <button
                    className="w-fit rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={persistenceOperation !== "idle"}
                    onClick={() => openClearConfirmation("recovery")}
                    type="button"
                  >
                    {t("dashboard.dataManagement.clearDamaged")}
                  </button>
                ) : null}

                {clearConfirmationMode ? (
                  <div className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="font-medium text-red-900">
                      {clearConfirmationMode === "normal"
                        ? storageKind === "ledger-file"
                          ? t("dashboard.dataManagement.clearFileWarning")
                          : t("dashboard.dataManagement.clearLegacyWarning")
                        : t("dashboard.dataManagement.clearRecoveryWarning")}
                    </p>
                    <label className="grid gap-2 font-medium text-red-900">
                      {t("dashboard.dataManagement.confirmPrefix")}“{clearConfirmationPhrase}”{t("dashboard.dataManagement.confirmSuffix")}
                      <input
                        aria-label={t("dashboard.dataManagement.confirmAriaLabel")}
                        className="rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-slate-950 outline-none focus:border-red-500"
                        disabled={persistenceOperation !== "idle"}
                        onChange={(event) => {
                          setClearConfirmationValue(event.target.value);
                          setClearConfirmationError("");
                        }}
                        value={clearConfirmationValue}
                      />
                    </label>
                    {clearConfirmationError ? (
                      <p aria-live="polite" className="text-red-800">
                        {clearConfirmationError}
                      </p>
                    ) : null}
                    {persistenceOperation === "clearing" ? (
                      <p aria-live="polite" className="font-medium text-red-900">
                        {t("dashboard.dataManagement.clearing")}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="rounded-md bg-red-800 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={() => void handleClearLedger()}
                        type="button"
                      >
                        {storageKind === "ledger-file"
                          ? t("dashboard.dataManagement.confirmClearFile")
                          : t("dashboard.dataManagement.confirmClearLegacy")}
                      </button>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={cancelClearConfirmation}
                        type="button"
                      >
                        {t("dashboard.action.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}

                {clearSuccessMessage ? (
                  <p
                    aria-live="polite"
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800"
                  >
                    {clearSuccessMessage}
                  </p>
                ) : null}
              </div>
            </Section>
  );
}
