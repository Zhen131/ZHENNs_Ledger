import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type {
  ArmedDelete,
  PendingRisk,
} from "./cashEventPanelHelpers";
import type {
  CashEvent,
  CashEventType,
  LedgerData,
} from "@/core/models";
import {
  captureLedgerTime,
  getLedgerTimeZone,
  resolveFactMoment,
} from "@/core/shared";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { useLanguage } from "@/ui";
import { createValidatedCashEvent } from "./cashEventService";
import { projectLedgerCashMutation } from "./cashProjection";

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

type HandleSubmitDeps = {
  amountOrTarget: string;
  applyAdd: (cashEvent: CashEvent, timeSnapshot: LedgerTimeSnapshot) => void;
  clock: LedgerClock;
  isWritable: boolean;
  lastRiskTriggerRef: RefObject<HTMLElement | null>;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  note: string;
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  pendingMutationVersion: number | null;
  persistedVersion: number;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingRisk: Dispatch<SetStateAction<PendingRisk | null>>;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  t: ReturnType<typeof useLanguage>["t"];
  type: CashEventType;
};

export function doHandleSubmit(
  deps: HandleSubmitDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    amountOrTarget,
    applyAdd,
    clock,
    isWritable,
    lastRiskTriggerRef,
    ledgerData,
    ledgerEpoch,
    mutationVersion,
    note,
    occurredAt,
    occurredTime,
    occurredTimeZone,
    pendingMutationVersion,
    persistedVersion,
    setError,
    setFeedback,
    setPendingRisk,
    submitButtonRef,
    t,
    type,
  } = deps;
    event.preventDefault();
    if (!isWritable || pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);
    const moment = resolveFactMoment(occurredAt, occurredTime, occurredTimeZone);
    if (!moment.ok) {
      setError(
        t(
          moment.reason === "nonexistent"
            ? "cash.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "cash.validation.ambiguousWallTime"
              : "cash.validation.invalidTimeZone",
        ),
      );
      setFeedback("");
      return;
    }
    const result = createValidatedCashEvent(
      { type, ...moment.value, amountOrTarget, note },
      ledgerData,
      {
        generateId: () => globalThis.crypto.randomUUID(),
        now: () => timeSnapshot.now.toISOString(),
        todayKey: () => timeSnapshot.todayKey,
      },
    );
    if (!result.ok) {
      setError(result.error.message);
      setFeedback("");
      return;
    }
    if (result.projection.requiresNegativeBalanceConfirmation) {
      lastRiskTriggerRef.current = submitButtonRef.current;
      setPendingRisk({
        operation: "add",
        cashEvent: result.cashEvent,
        projection: result.projection,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
        timeSnapshot,
      });
      return;
    }
    applyAdd(result.cashEvent, timeSnapshot);
}

type RequestDeleteDeps = {
  applyDelete: (cashEventId: string, timeSnapshot: LedgerTimeSnapshot) => void;
  armedDelete: ArmedDelete | null;
  clock: LedgerClock;
  isWritable: boolean;
  lastRiskTriggerRef: RefObject<HTMLElement | null>;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  pendingMutationVersion: number | null;
  persistedVersion: number;
  setArmedDelete: Dispatch<SetStateAction<ArmedDelete | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingRisk: Dispatch<SetStateAction<PendingRisk | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doRequestDelete(
  deps: RequestDeleteDeps,
  cashEvent: CashEvent,
  trigger: HTMLButtonElement,
) {
  const {
    applyDelete,
    armedDelete,
    clock,
    isWritable,
    lastRiskTriggerRef,
    ledgerData,
    ledgerEpoch,
    mutationVersion,
    pendingMutationVersion,
    persistedVersion,
    setArmedDelete,
    setError,
    setFeedback,
    setPendingRisk,
    t,
  } = deps;
    if (!isWritable || pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);
    const nextLedger = {
      ...ledgerData,
      cashEvents: ledgerData.cashEvents.filter((item) => item.id !== cashEvent.id),
    };
    const projection = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      timeSnapshot.todayKey,
    );
    if (projection.requiresNegativeBalanceConfirmation) {
      lastRiskTriggerRef.current = trigger;
      setPendingRisk({
        operation: "delete",
        cashEvent,
        projection,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
        timeSnapshot,
      });
      setArmedDelete(null);
      return;
    }
    if (armedDelete?.cashEventId !== cashEvent.id) {
      setArmedDelete({
        cashEventId: cashEvent.id,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
      });
      setFeedback(t("cash.status.deleteArmed"));
      return;
    }
    if (
      armedDelete.ledgerEpoch !== ledgerEpoch ||
      armedDelete.mutationVersion !== mutationVersion ||
      armedDelete.persistedVersion !== persistedVersion
    ) {
      setArmedDelete(null);
      setError(t("cash.status.deleteStale"));
      return;
    }
    applyDelete(cashEvent.id, timeSnapshot);
}

type ConfirmNegativeBalanceDeps = {
  applyAdd: (cashEvent: CashEvent, timeSnapshot: LedgerTimeSnapshot) => void;
  applyDelete: (cashEventId: string, timeSnapshot: LedgerTimeSnapshot) => void;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  pendingRisk: PendingRisk | null;
  persistedVersion: number;
  setError: Dispatch<SetStateAction<string>>;
  setPendingRisk: Dispatch<SetStateAction<PendingRisk | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doConfirmNegativeBalance(
  deps: ConfirmNegativeBalanceDeps,
) {
  const {
    applyAdd,
    applyDelete,
    ledgerData,
    ledgerEpoch,
    mutationVersion,
    pendingRisk,
    persistedVersion,
    setError,
    setPendingRisk,
    t,
  } = deps;
    const pending = pendingRisk;
    if (!pending) return;
    if (
      pending.ledgerEpoch !== ledgerEpoch ||
      pending.mutationVersion !== mutationVersion ||
      pending.persistedVersion !== persistedVersion
    ) {
      setPendingRisk(null);
      setError(t("cash.status.confirmationStale"));
      return;
    }
    const nextLedger =
      pending.operation === "add"
        ? {
            ...ledgerData,
            cashEvents: [...ledgerData.cashEvents, pending.cashEvent],
          }
        : {
            ...ledgerData,
            cashEvents: ledgerData.cashEvents.filter(
              (item) => item.id !== pending.cashEvent.id,
            ),
          };
    const latestProjection = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      pending.timeSnapshot.todayKey,
    );
    if (
      !latestProjection.requiresNegativeBalanceConfirmation ||
      latestProjection.nextBalance !== pending.projection.nextBalance
    ) {
      setPendingRisk(null);
      setError(t("cash.status.resultStale"));
      return;
    }
    setPendingRisk(null);
    if (pending.operation === "add") {
      applyAdd(pending.cashEvent, pending.timeSnapshot);
    } else {
      applyDelete(pending.cashEvent.id, pending.timeSnapshot);
    }
}
