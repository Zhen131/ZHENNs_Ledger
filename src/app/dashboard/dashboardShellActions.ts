import type { LedgerData } from "@/core/models";
import type { PersistentLedgerState } from "@/app/persistence";
import { validateTradeRemoval } from "@/features/trades";
import type { ConfirmDeleteOutcome, useLanguage } from "@/ui";

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
