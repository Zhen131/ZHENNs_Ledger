/**
 * 这个文件放价格表单的三件「事后要做的事」。
 * 它们是修币、换账本清空、存盘后收尾，什么时候触发由 `PriceForm.tsx` 定。
 * 没有特别的决定。
 */
import type {
  PriceFormField,
  PriceFormState,
} from "./priceFormHelpers";
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
import type { PersistenceStatus } from "@/app";
import type { Translate } from "@/ui";

type PriceAssetRepairEffectDeps = {
  commitForm: (next: PriceFormState) => void;
  form: PriceWorkspaceDraft;
  ledgerData: LedgerData;
};

/**
 * 这个函数在币的清单变了以后修一下价格表单。
 * 表单里选的币已经不在清单里，就换成清单第一个币。
 * 举例：表单选着 SOL，SOL 被删了，清单第一个是 BTC → 换成 BTC。
 * 不会出错。
 */
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

/**
 * 这个函数在换了一本账本时清空价格表单的状态。
 * 表单由记账页保管时，表单值不动；自己保管时换成新表单。
 * 不会出错。
 */
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

type PendingPriceSaveEffectDeps = {
  certifiedSavedMessage: string;
  clock: LedgerClock;
  draft: PriceWorkspaceDraft | undefined;
  onReset: ((preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">) => void) | undefined;
  pendingMutationVersion: number | null;
  pendingResetRef: RefObject<Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined>;
  persistedVersion: number | undefined;
  persistenceStatus: PersistenceStatus | undefined;
  setErrors: Dispatch<SetStateAction<Partial<Record<PriceFormField, string>>>>;
  setLocalForm: Dispatch<SetStateAction<PriceFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数看存盘结果，决定价格表单怎么收尾。
 * 存到了这次的版本：清空表单，显示「已保存」。
 * 刚才的币和日期留着不清。
 * 存盘失败：显示「没存上」。
 * 没传存盘版本时什么都不做。
 */
export function runPendingPriceSaveEffect(
  deps: PendingPriceSaveEffectDeps,
) {
  const {
    certifiedSavedMessage,
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
    setSuccessMessage,
    t,
  } = deps;
    if (
      pendingMutationVersion === null ||
      persistedVersion === undefined ||
      persistenceStatus === undefined
    ) {
      return;
    }
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
            ...createPriceWorkspaceDraft(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
              clock,
            ),
            recordedAt: preserve.recordedAt,
          });
        }
      }
      setErrors({});
      setSuccessMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessMessage("");
      setErrors((current) => ({
        ...current,
        form: t("prices.status.unsaved"),
      }));
    }
}
