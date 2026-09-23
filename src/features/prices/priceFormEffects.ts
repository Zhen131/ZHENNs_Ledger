import type { PriceFormState } from "./priceFormHelpers";
import type { PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { createPriceWorkspaceDraft } from "./priceWorkspaceDraft";
import { captureLedgerTime } from "@/core/shared";

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

type PriceEpochResetEffectDeps = {
  clock: LedgerClock;
  draft: PriceWorkspaceDraft | undefined;
  ledgerData: LedgerData;
  pendingResetRef: RefObject<Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined>;
  setLocalForm: Dispatch<SetStateAction<PriceFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string>>;
};

export function runPriceEpochResetEffect(
  deps: PriceEpochResetEffectDeps,
) {
  const {
    clock,
    draft,
    ledgerData,
    pendingResetRef,
    setLocalForm,
    setPendingMutationVersion,
    setSuccessMessage,
  } = deps;
    setPendingMutationVersion(null);
    pendingResetRef.current = undefined;
    setSuccessMessage("");
    if (!draft) {
      setLocalForm(
        createPriceWorkspaceDraft(
          ledgerData.assets[0]?.symbol ?? "",
          captureLedgerTime(clock).todayKey,
          clock,
        ),
      );
    }
}
