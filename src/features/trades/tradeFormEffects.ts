import type { TradeFormState } from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type { LedgerData } from "@/core/models";

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
