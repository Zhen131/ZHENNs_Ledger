import type {
  PendingTradeRisk,
  TradeFormField,
  TradeFormState,
} from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";
import { calculateAutomaticTotal } from "./tradeFormHelpers";

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
