import type { Dispatch, SetStateAction } from "react";

import type { LedgerData } from "@/core/models";
import type { PersistentLedgerState } from "@/app/persistence";
import { validateTradeRemoval } from "@/features/trades";
import type { ConfirmDeleteOutcome, useLanguage } from "@/ui";
import { validateAssetTransferRemoval } from "@/features/asset-transfers";
import type { ClearConfirmationMode } from "./DashboardShellTypes";

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
