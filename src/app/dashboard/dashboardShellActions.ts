import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { LedgerData } from "@/core/models";
import type { PersistentLedgerState } from "@/app/persistence";
import { validateTradeRemoval } from "@/features/trades";
import type { ConfirmDeleteOutcome, useLanguage } from "@/ui";
import { validateAssetTransferRemoval } from "@/features/asset-transfers";
import type { ClearConfirmationMode } from "./DashboardShellTypes";
import type {
  LedgerRepository,
  LedgerSession,
  LedgerStorageKind,
  SessionQuiesceReason,
} from "@/platform/persistence";
import type { useLedgerWorkspaceSession } from "@/app/workspaces";
import { FILE_SAVED_FEEDBACK_MS } from "./DashboardShellHelpers";

type RemoveValidatedTradeDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  ledgerData: LedgerData;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doRemoveValidatedTrade(
  deps: RemoveValidatedTradeDeps,
  tradeId: string,
  setError: (message: string) => void,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    ledgerData,
    t,
  } = deps;
    const result = validateTradeRemoval(tradeId, ledgerData);

    if (!result.ok) {
      setError(
        result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
          ? t("dashboard.delete.tradeHasDependents")
          : t("dashboard.delete.tradeMissing"),
      );
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "trade/delete",
      tradeId: result.tradeId,
    });
    setError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteFuturePriceDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doHandleDeleteFuturePrice(
  deps: HandleDeleteFuturePriceDeps,
  priceSnapshotId: string,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    setFutureCorrectionError,
    t,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "priceSnapshot/delete",
      priceSnapshotId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteFutureAssetTransferDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  ledgerData: PersistentLedgerState["ledgerData"];
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doHandleDeleteFutureAssetTransfer(
  deps: HandleDeleteFutureAssetTransferDeps,
  assetTransferId: string,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    ledgerData,
    setFutureCorrectionError,
    t,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }

    const result = validateAssetTransferRemoval(assetTransferId, ledgerData);
    if (!result.ok) {
      setFutureCorrectionError(result.error.message);
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "assetTransfer/delete",
      assetTransferId: result.assetTransferId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteAllFutureFactsDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
  todayKey: PersistentLedgerState["todayKey"];
};

export function doHandleDeleteAllFutureFacts(
  deps: HandleDeleteAllFutureFactsDeps,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    setFutureCorrectionError,
    t,
    todayKey,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "futureFacts/deleteAll",
      todayKey,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type OpenClearConfirmationDeps = {
  hydrationStatus: PersistentLedgerState["hydrationStatus"];
  isReadOnly: PersistentLedgerState["isReadOnly"];
  persistenceOperation: PersistentLedgerState["persistenceOperation"];
  repositorySwitchBlocked: PersistentLedgerState["repositorySwitchBlocked"];
  setClearConfirmationError: Dispatch<SetStateAction<string>>;
  setClearConfirmationMode: Dispatch<SetStateAction<ClearConfirmationMode | null>>;
  setClearConfirmationValue: Dispatch<SetStateAction<string>>;
  setClearSuccessMessage: Dispatch<SetStateAction<string>>;
};

export function doOpenClearConfirmation(
  deps: OpenClearConfirmationDeps,
  mode: ClearConfirmationMode,
) {
  const {
    hydrationStatus,
    isReadOnly,
    persistenceOperation,
    repositorySwitchBlocked,
    setClearConfirmationError,
    setClearConfirmationMode,
    setClearConfirmationValue,
    setClearSuccessMessage,
  } = deps;
    if (
      persistenceOperation !== "idle" ||
      repositorySwitchBlocked ||
      isReadOnly ||
      (mode === "normal" && hydrationStatus !== "ready") ||
      (mode === "recovery" && hydrationStatus !== "error")
    ) {
      return;
    }

    setClearConfirmationMode(mode);
    setClearConfirmationValue("");
    setClearConfirmationError("");
    setClearSuccessMessage("");
}

type HandleClearLedgerDeps = {
  clearConfirmationNonce: string;
  clearConfirmationPhrase: string;
  clearConfirmationValue: string;
  clearLedger: PersistentLedgerState["clearLedger"];
  currentRepositoryRef: RefObject<LedgerRepository>;
  mountedRef: RefObject<boolean>;
  repository: LedgerRepository | undefined;
  setClearConfirmationError: Dispatch<SetStateAction<string>>;
  setClearConfirmationMode: Dispatch<SetStateAction<ClearConfirmationMode | null>>;
  setClearConfirmationValue: Dispatch<SetStateAction<string>>;
  setClearSuccessMessage: Dispatch<SetStateAction<string>>;
  setSelectedTradeDate: Dispatch<SetStateAction<string | null>>;
  setTradeRemovalError: Dispatch<SetStateAction<string>>;
  storageKind: LedgerStorageKind;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doHandleClearLedger(
  deps: HandleClearLedgerDeps,
) {
  const {
    clearConfirmationNonce,
    clearConfirmationPhrase,
    clearConfirmationValue,
    clearLedger,
    currentRepositoryRef,
    mountedRef,
    repository,
    setClearConfirmationError,
    setClearConfirmationMode,
    setClearConfirmationValue,
    setClearSuccessMessage,
    setSelectedTradeDate,
    setTradeRemovalError,
    storageKind,
    t,
  } = deps;
    if (clearConfirmationValue !== clearConfirmationPhrase) {
      setClearConfirmationError(
        `${t("dashboard.clearConfirmation.errorPrefix")}“${clearConfirmationPhrase}”`,
      );
      return;
    }

    const operationRepository = repository;
    setClearConfirmationError("");
    setClearSuccessMessage("");
    const result = await clearLedger(clearConfirmationNonce);

    if (
      !mountedRef.current ||
      currentRepositoryRef.current !== operationRepository
    ) {
      return;
    }

    if (!result.ok) {
      return;
    }

    setTradeRemovalError("");
    setSelectedTradeDate(null);
    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearSuccessMessage(
      storageKind === "ledger-file"
        ? t("dashboard.clearSuccess.file")
        : t("dashboard.clearSuccess.legacy"),
    );
}

type HandleSettingsClearDeps = {
  clearConfirmationNonce: string;
  clearLedger: PersistentLedgerState["clearLedger"];
  currentRepositoryRef: RefObject<LedgerRepository>;
  hydrationStatus: PersistentLedgerState["hydrationStatus"];
  mountedRef: RefObject<boolean>;
  repository: LedgerRepository | undefined;
  setSelectedTradeDate: Dispatch<SetStateAction<string | null>>;
  setTradeRemovalError: Dispatch<SetStateAction<string>>;
};

export async function doHandleSettingsClear(
  deps: HandleSettingsClearDeps,
  mode: "normal" | "recovery",
): Promise<boolean> {
  const {
    clearConfirmationNonce,
    clearLedger,
    currentRepositoryRef,
    hydrationStatus,
    mountedRef,
    repository,
    setSelectedTradeDate,
    setTradeRemovalError,
  } = deps;
    if (
      (mode === "normal" && hydrationStatus !== "ready") ||
      (mode === "recovery" && hydrationStatus !== "error")
    ) {
      return false;
    }
    const operationRepository = repository;
    const result = await clearLedger(clearConfirmationNonce);
    if (
      !mountedRef.current ||
      currentRepositoryRef.current !== operationRepository ||
      !result.ok
    ) {
      return false;
    }
    setTradeRemovalError("");
    setSelectedTradeDate(null);
    return true;
}

type RequestImmediateLockDeps = {
  drainForSessionQuiesce: PersistentLedgerState["drainForSessionQuiesce"];
  isDirty: PersistentLedgerState["isDirty"];
  lifecycleStatus: PersistentLedgerState["lifecycleStatus"];
  onFinalLock: ((drain: PersistentLedgerState["drainForSessionQuiesce"], reason: SessionQuiesceReason) => Promise<void>) | undefined;
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  session: LedgerSession | undefined;
  setLockConfirmationHasDrafts: Dispatch<SetStateAction<boolean>>;
  setShowLockConfirmation: Dispatch<SetStateAction<boolean>>;
  workspace: ReturnType<typeof useLedgerWorkspaceSession>;
  workspaceDraftsPresentRef: RefObject<boolean>;
};

export function doRequestImmediateLock(
  deps: RequestImmediateLockDeps,
) {
  const {
    drainForSessionQuiesce,
    isDirty,
    lifecycleStatus,
    onFinalLock,
    persistenceStatus,
    session,
    setLockConfirmationHasDrafts,
    setShowLockConfirmation,
    workspace,
    workspaceDraftsPresentRef,
  } = deps;
    if (!session || !onFinalLock || lifecycleStatus !== "active") {
      return;
    }
    const hasDrafts = workspaceDraftsPresentRef.current;
    if (
      isDirty ||
      hasDrafts ||
      persistenceStatus === "saving" ||
      persistenceStatus === "error"
    ) {
      setLockConfirmationHasDrafts(hasDrafts);
      setShowLockConfirmation(true);
      return;
    }
    workspace.resetSessionUi();
    void onFinalLock(
      drainForSessionQuiesce,
      "immediate-lock",
    );
}

type SavedFeedbackEffectDeps = {
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  setShowSavedFeedback: Dispatch<SetStateAction<boolean>>;
};

export function runSavedFeedbackEffect(
  deps: SavedFeedbackEffectDeps,
) {
  const {
    persistenceStatus,
    setShowSavedFeedback,
  } = deps;
    if (persistenceStatus !== "saved") {
      setShowSavedFeedback(false);
      return;
    }

    setShowSavedFeedback(true);
    const timeout = setTimeout(
      () => setShowSavedFeedback(false),
      FILE_SAVED_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
}
