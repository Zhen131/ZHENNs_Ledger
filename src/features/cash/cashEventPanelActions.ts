import type { LedgerClock } from "@/core/shared";
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
