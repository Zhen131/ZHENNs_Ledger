import type { PriceFormState } from "./priceFormHelpers";
import type { PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { LedgerData } from "@/core/models";

type PriceAssetRepairEffectDeps = {
  commitForm: (next: PriceFormState) => void;
  form: PriceWorkspaceDraft;
  ledgerData: LedgerData;
};

export function runPriceAssetRepairEffect(
  deps: PriceAssetRepairEffectDeps,
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
