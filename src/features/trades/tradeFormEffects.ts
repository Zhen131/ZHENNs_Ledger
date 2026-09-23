import type {
  PendingTradeRisk,
  TradeFormField,
  TradeFormState,
} from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { createTradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import { captureLedgerTime } from "@/core/shared";
import type { PersistenceStatus } from "@/app";
import type { useLanguage } from "@/ui";

type AssetRepairEffectDeps = {
  commitForm: (next: TradeFormState) => void;
  form: TradeWorkspaceDraft;
  ledgerData: LedgerData;
};

export function runAssetRepairEffect(
  deps: AssetRepairEffectDeps,
) {
  const {
    commitForm,
    form,
    ledgerData,
  } = deps;
    if (
      ledgerData.assets.some(
        (asset) => asset.symbol === form.assetSymbol,
      )
    ) {
      return;
    }
    commitForm({
      ...form,
      assetSymbol: ledgerData.assets[0]?.symbol ?? "",
    });
}

type EpochResetEffectDeps = {
  clock: LedgerClock;
  draft: TradeWorkspaceDraft | undefined;
  ledgerData: LedgerData;
  pendingResetRef: RefObject<Pick<TradeWorkspaceDraft, "assetSymbol" | "platform"> | undefined>;
  setLocalForm: Dispatch<SetStateAction<TradeFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingRisk: Dispatch<SetStateAction<PendingTradeRisk | null>>;
  setSelectedFeeRuleId: Dispatch<SetStateAction<string>>;
  setSourceChangedMessage: Dispatch<SetStateAction<string>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
};

export function runEpochResetEffect(
  deps: EpochResetEffectDeps,
) {
  const {
    clock,
    draft,
    ledgerData,
    pendingResetRef,
    setLocalForm,
    setPendingMutationVersion,
    setPendingRisk,
    setSelectedFeeRuleId,
    setSourceChangedMessage,
    setSuccessState,
  } = deps;
    setPendingMutationVersion(null);
    setSuccessState("");
    setSelectedFeeRuleId("");
    setSourceChangedMessage("");
    setPendingRisk(null);
    pendingResetRef.current = undefined;
    if (!draft) {
      setLocalForm(
        createTradeWorkspaceDraft(
          ledgerData.assets[0]?.symbol ?? "",
          captureLedgerTime(clock).todayKey,
          clock,
        ),
      );
    }
}

type PendingSaveEffectDeps = {
  clock: LedgerClock;
  draft: TradeWorkspaceDraft | undefined;
  onReset: ((preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">) => void) | undefined;
  pendingMutationVersion: number | null;
  pendingResetRef: RefObject<Pick<TradeWorkspaceDraft, "assetSymbol" | "platform"> | undefined>;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setLocalForm: Dispatch<SetStateAction<TradeFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSelectedFeeRuleId: Dispatch<SetStateAction<string>>;
  setSourceChangedMessage: Dispatch<SetStateAction<string>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runPendingSaveEffect(
  deps: PendingSaveEffectDeps,
) {
  const {
    clock,
    draft,
    onReset,
    pendingMutationVersion,
    pendingResetRef,
    persistedVersion,
    persistenceStatus,
    setErrors,
    setLocalForm,
    setPendingMutationVersion,
    setSelectedFeeRuleId,
    setSourceChangedMessage,
    setSuccessState,
    t,
  } = deps;
    if (pendingMutationVersion === null) return;
    if (
      persistedVersion >= pendingMutationVersion &&
      persistenceStatus === "saved"
    ) {
      const preserve = pendingResetRef.current;
      setPendingMutationVersion(null);
      pendingResetRef.current = undefined;
      if (preserve) {
        if (draft && onReset) {
          onReset(preserve);
        } else {
          setLocalForm({
            ...createTradeWorkspaceDraft(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
              clock,
            ),
            platform: preserve.platform,
          });
        }
      }
      setSelectedFeeRuleId("");
      setSourceChangedMessage("");
      setErrors({});
      setSuccessState("certified");
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessState("");
      setErrors((current) => ({
        ...current,
        form: t("trades.form.error.notPersisted"),
      }));
    }
}
