import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type {
  ArmedDelete,
  PendingRisk,
} from "./cashEventPanelHelpers";
import type { CashEventType } from "@/core/models";
import {
  captureLedgerTime,
  getLedgerTimeZone,
} from "@/core/shared";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { useLanguage } from "@/ui";

type CashFormEpochResetEffectDeps = {
  clock: LedgerClock;
  setAmountOrTarget: Dispatch<SetStateAction<string>>;
  setArmedDelete: Dispatch<SetStateAction<ArmedDelete | null>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setOccurredAt: Dispatch<SetStateAction<string>>;
  setOccurredTime: Dispatch<SetStateAction<string>>;
  setOccurredTimeZone: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  setPendingRisk: Dispatch<SetStateAction<PendingRisk | null>>;
  setType: Dispatch<SetStateAction<CashEventType>>;
};

export function runCashFormEpochResetEffect(
  deps: CashFormEpochResetEffectDeps,
) {
  const {
    clock,
    setAmountOrTarget,
    setArmedDelete,
    setCurrentPage,
    setError,
    setFeedback,
    setNote,
    setOccurredAt,
    setOccurredTime,
    setOccurredTimeZone,
    setPendingMutationVersion,
    setPendingOperation,
    setPendingRisk,
    setType,
  } = deps;
    setType("deposit");
    setAmountOrTarget("");
    setOccurredAt(captureLedgerTime(clock).todayKey);
    setOccurredTime("");
    setOccurredTimeZone(getLedgerTimeZone(clock));
    setNote("");
    setError("");
    setFeedback("");
    setPendingRisk(null);
    setArmedDelete(null);
    setPendingMutationVersion(null);
    setPendingOperation(null);
    setCurrentPage(1);
}

type CashPersistenceEffectDeps = {
  certifiedSavedFeedback: string;
  deletedFeedback: string;
  pendingMutationVersion: number | null;
  pendingOperation: "add" | "delete" | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setAmountOrTarget: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runCashPersistenceEffect(
  deps: CashPersistenceEffectDeps,
) {
  const {
    certifiedSavedFeedback,
    deletedFeedback,
    pendingMutationVersion,
    pendingOperation,
    persistedVersion,
    persistenceStatus,
    setAmountOrTarget,
    setError,
    setFeedback,
    setNote,
    setPendingMutationVersion,
    setPendingOperation,
    t,
  } = deps;
    if (pendingMutationVersion === null) return;
    if (persistenceStatus === "error") {
      setError(t("cash.status.unsaved"));
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingMutationVersion
    ) {
      if (pendingOperation === "add") {
        setAmountOrTarget("");
        setNote("");
        setFeedback(certifiedSavedFeedback);
      } else {
        setFeedback(deletedFeedback);
      }
      setError("");
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
}

type ApplyDeleteDeps = {
  mutationVersion: number;
  onCashEventDeleted: (cashEventId: string, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  savingDeleteFeedback: string;
  setArmedDelete: Dispatch<SetStateAction<ArmedDelete | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doApplyDelete(
  deps: ApplyDeleteDeps,
  cashEventId: string,
  timeSnapshot: LedgerTimeSnapshot,
) {
  const {
    mutationVersion,
    onCashEventDeleted,
    savingDeleteFeedback,
    setArmedDelete,
    setError,
    setFeedback,
    setPendingMutationVersion,
    setPendingOperation,
    t,
  } = deps;
    const outcome = onCashEventDeleted(cashEventId, timeSnapshot);
    setArmedDelete(null);
    if (outcome !== "applied") {
      setError(outcome === "rejected" ? t("cash.status.ledgerNotWritable") : t("cash.status.notFound"));
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("delete");
    setFeedback(savingDeleteFeedback);
    setError("");
}
