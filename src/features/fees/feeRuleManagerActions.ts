import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";
import type { LedgerAction } from "@/core/state";

type FeeRulePersistenceEffectDeps = {
  certifiedSavedMessage: string;
  pendingVersion: number | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingVersion: Dispatch<SetStateAction<number | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runFeeRulePersistenceEffect(
  deps: FeeRulePersistenceEffectDeps,
) {
  const {
    certifiedSavedMessage,
    pendingVersion,
    persistedVersion,
    persistenceStatus,
    setError,
    setMessage,
    setPendingVersion,
    t,
  } = deps;
    if (pendingVersion === null) return;
    if (
      persistedVersion >= pendingVersion &&
      persistenceStatus === "saved"
    ) {
      setPendingVersion(null);
      setMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setPendingVersion(null);
      setMessage("");
      setError(t("fees.status.unsaved"));
    }
}

type ApplyDeps = {
  mutationVersion: number;
  onAction: (action: LedgerAction) => ApplyLedgerActionResult;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingVersion: Dispatch<SetStateAction<number | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doApply(
  deps: ApplyDeps,
  action: LedgerAction,
  pendingMessage: string,
) {
  const {
    mutationVersion,
    onAction,
    setError,
    setMessage,
    setPendingVersion,
    t,
  } = deps;
    setError("");
    setMessage("");
    const result = onAction(action);
    if (result !== "applied") {
      setError(
        result === "rejected"
          ? t("fees.status.ledgerNotWritable")
          : t("fees.status.unchanged"),
      );
      return;
    }
    setPendingVersion(mutationVersion + 1);
    setMessage(pendingMessage);
}
