import type {
  PendingTradeRisk,
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
