import type {
  PendingTradeRisk,
  TradeFormField,
  TradeFormState,
} from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";
import { calculateAutomaticTotal } from "./tradeFormHelpers";
import type { Trade } from "@/core/models";
import type { LedgerTimeSnapshot } from "@/core/shared";
import type { ApplyLedgerActionResult } from "@/app";

type UpdateFieldDeps = {
  commitForm: (next: TradeFormState) => void;
  form: TradeWorkspaceDraft;
  pendingMutationVersion: number | null;
  selectedFeeRuleId: string;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingRisk: Dispatch<SetStateAction<PendingTradeRisk | null>>;
  setSelectedFeeRuleId: Dispatch<SetStateAction<string>>;
  setSourceChangedMessage: Dispatch<SetStateAction<string>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doUpdateField<Field extends keyof TradeFormState>(
  deps: UpdateFieldDeps,
  field: Field,
  value: TradeFormState[Field],
) {
  const {
    commitForm,
    form,
    pendingMutationVersion,
    selectedFeeRuleId,
    setErrors,
    setPendingRisk,
    setSelectedFeeRuleId,
    setSourceChangedMessage,
    setSuccessState,
    t,
  } = deps;
    if (pendingMutationVersion !== null) return;
    let next = { ...form, [field]: value };
    if (field === "totalValue") {
      next = { ...next, totalValueMode: "manual" };
    }
    if (
      (field === "quantity" || field === "price") &&
      next.totalValueMode === "auto"
    ) {
      next = {
        ...next,
        totalValue: calculateAutomaticTotal(next.quantity, next.price),
      };
    }
    commitForm(next);
    if (
      (field === "platform" || field === "assetSymbol") &&
      selectedFeeRuleId !== ""
    ) {
      setSelectedFeeRuleId("");
      setSourceChangedMessage(
        t("trades.form.sourceChanged"),
      );
    }
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessState("");
    setPendingRisk(null);
}

type ApplyTradeDeps = {
  form: TradeWorkspaceDraft;
  mutationVersion: number;
  onTradeCreated: (trade: Trade, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  pendingResetRef: RefObject<Pick<TradeWorkspaceDraft, "assetSymbol" | "platform"> | undefined>;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doApplyTrade(
  deps: ApplyTradeDeps,
  trade: Trade,
  timeSnapshot: LedgerTimeSnapshot,
) {
  const {
    form,
    mutationVersion,
    onTradeCreated,
    pendingResetRef,
    setErrors,
    setPendingMutationVersion,
    setSuccessState,
    t,
  } = deps;
    const mutationResult = onTradeCreated(trade, timeSnapshot);

    if (mutationResult !== "applied") {
      setErrors({
        form:
          mutationResult === "rejected"
            ? t("trades.form.error.ledgerNotWritable")
            : t("trades.form.error.ledgerUnchanged"),
      });
      setSuccessState("");
      return;
    }

    pendingResetRef.current = {
      assetSymbol: form.assetSymbol,
      platform: form.platform,
    };
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessState("saving");
}
