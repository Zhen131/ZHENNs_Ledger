/**
 * 这个文件放交易表单的三件「事后要做的事」。
 * 它们是修币、换账本清空、存盘后收尾。
 * 它们什么时候触发由 `TradeForm.tsx` 定。
 * 没有特别的决定。
 */
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
import type { Translate } from "@/ui";

type AssetRepairEffectDeps = {
  commitForm: (next: TradeFormState) => void;
  form: TradeWorkspaceDraft;
  ledgerData: LedgerData;
};

/**
 * 这个函数在币的清单变了以后修一下表单。
 * 表单里选的币已经不在清单里，就换成清单第一个币。
 * 举例：表单选着 SOL，SOL 被删了，清单第一个是 BTC → 表单换成 BTC。
 * 不会出错。
 */
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

/**
 * 这个函数在换了一本账本时清空交易表单的状态。
 * 等存盘、已选规则、提示、负余额确认都清掉。
 * 表单由记账页保管时，表单值不动；自己保管时换成新表单。
 * 不会出错。
 */
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
  t: Translate;
};

/**
 * 这个函数看存盘结果，决定交易表单怎么收尾。
 * 存到了这次的版本：清空表单，显示「已保存」。
 * 刚才的币和平台留着不清。
 * 存盘失败：显示「没存上」。
 * 不会出错。
 */
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
