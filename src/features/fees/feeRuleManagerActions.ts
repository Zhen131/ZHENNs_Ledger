import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";
import type { LedgerAction } from "@/core/state";
import type { LedgerClock } from "@/core/shared";
import type { FormState } from "./feeRuleManagerHelpers";
import type {
  FeeRule,
  LedgerData,
} from "@/core/models";
import {
  createUniqueFeeRuleId,
  validateForm,
} from "./feeRuleManagerHelpers";
import { captureLedgerTime } from "@/core/shared";

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

type SubmitNewRuleDeps = {
  apply: (action: LedgerAction, pendingMessage: string) => void;
  clock: LedgerClock;
  form: FormState;
  ledgerData: LedgerData;
  setError: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doSubmitNewRule(
  deps: SubmitNewRuleDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    apply,
    clock,
    form,
    ledgerData,
    setError,
    t,
  } = deps;
    event.preventDefault();
    const validation = validateForm(form, t);
    if (validation) {
      setError(validation);
      return;
    }
    const id = createUniqueFeeRuleId(ledgerData);
    if (!id) {
      setError(t("fees.error.idGenerationExhausted"));
      return;
    }
    const timestamp = captureLedgerTime(clock).now.toISOString();
    const common = {
      id,
      name: form.name,
      platform: form.platform,
      assetSymbol: form.assetSymbol,
      status: "active" as const,
      currency: "USDT" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const feeRule: FeeRule =
      form.type === "fixed"
        ? { ...common, type: "fixed", amount: form.value }
        : { ...common, type: "percentage", rate: form.value };
    apply({ type: "feeRule/add", feeRule }, t("fees.status.pendingAdd"));
}
