/**
 * 这个文件管转账面板上每个按钮按下后做什么。
 * 画面在 `AssetTransferPanel.tsx` 和它的子组件。
 * 不显然的决定：删除要点两次，两次之间账本变了就作废；为什么，这是猜的，要核。
 */
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { AssetTransferServiceError } from "./assetTransferServiceContract";
import type { Translate } from "@/ui";
import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  LedgerData,
} from "@/core/models";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import {
  captureLedgerTime,
  resolveFactMoment,
} from "@/core/shared";
import {
  createValidatedAssetTransfer,
  validateAssetTransferRemoval,
} from "./assetTransferService";
import type { ArmedDelete } from "./assetTransferPanelHelpers";

type TransferPersistenceEffectDeps = {
  deletedFeedback: string;
  pendingMutationVersion: number | null;
  pendingOperation: "add" | "delete" | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  savedFeedback: string;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setNetworkFee: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  setQuantity: Dispatch<SetStateAction<string>>;
  setUnitPrice: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数看存盘结果，决定提示什么。
 * 存到了这次改动的版本：显示「已保存」。
 * 同时清空数量、单价、网络费和备注。
 * 删除的显示「已删除」。
 * 存盘失败：显示「没存上」。
 * 不会出错。
 */
export function runTransferPersistenceEffect(
  deps: TransferPersistenceEffectDeps,
) {
  const {
    deletedFeedback,
    pendingMutationVersion,
    pendingOperation,
    persistedVersion,
    persistenceStatus,
    savedFeedback,
    setError,
    setFeedback,
    setNetworkFee,
    setNote,
    setPendingMutationVersion,
    setPendingOperation,
    setQuantity,
    setUnitPrice,
    t,
  } = deps;
    if (pendingMutationVersion === null) return;
    if (persistenceStatus === "error") {
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message: t("assetTransfers.status.unsaved"),
      });
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingMutationVersion
    ) {
      if (pendingOperation === "add") {
        setQuantity("");
        setUnitPrice("");
        setNetworkFee("");
        setNote("");
        setFeedback(savedFeedback);
      } else {
        setFeedback(deletedFeedback);
      }
      setError(null);
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
}

type HandleSubmitDeps = {
  assetSymbol: string;
  category: AssetTransferCategory;
  clock: LedgerClock;
  disabled: boolean;
  fromLocation: CustodyLocation;
  ledgerData: LedgerData;
  mutationVersion: number;
  networkFee: string;
  note: string;
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  onAssetTransferCreated: (assetTransfer: AssetTransfer, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  quantity: string;
  reason: AssetTransferReason;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  t: Translate;
  toLocation: CustodyLocation;
  unitPrice: string;
};

/**
 * 这个函数处理转账表单的「保存」。
 * 先把日期、时间、地点拼成一个时刻。
 * 再按分类只取用得上的栏，交给 `createValidatedAssetTransfer` 检查。
 * 检查过了就加进账本，等存盘。
 * 时刻不存在、检查不过、账本不让写：显示错误，不加。
 */
export function doHandleSubmit(
  deps: HandleSubmitDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    assetSymbol,
    category,
    clock,
    disabled,
    fromLocation,
    ledgerData,
    mutationVersion,
    networkFee,
    note,
    occurredAt,
    occurredTime,
    occurredTimeZone,
    onAssetTransferCreated,
    quantity,
    reason,
    setError,
    setFeedback,
    setPendingMutationVersion,
    setPendingOperation,
    t,
    toLocation,
    unitPrice,
  } = deps;
    event.preventDefault();
    if (disabled) return;
    const timeSnapshot = captureLedgerTime(clock);
    const moment = resolveFactMoment(occurredAt, occurredTime, occurredTimeZone);
    if (!moment.ok) {
      setError({
        code: "ASSET_TRANSFER_INVALID_DATE",
        field: "occurredAt",
        message: t(
          moment.reason === "nonexistent"
            ? "assetTransfer.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "assetTransfer.validation.ambiguousWallTime"
              : "assetTransfer.validation.invalidTimeZone",
        ),
      });
      setFeedback("");
      return;
    }
    const common = {
      category,
      assetSymbol,
      reason,
      quantity,
      ...moment.value,
      note,
    };
    const input =
      category === "internal"
        ? {
            ...common,
            fromLocation,
            toLocation,
            ...(networkFee === "" ? {} : { networkFee }),
          }
        : category === "external-out"
          ? {
              ...common,
              fromLocation,
              ...(networkFee === "" ? {} : { networkFee }),
            }
          : { ...common, toLocation, unitPrice };
    const result = createValidatedAssetTransfer(input, ledgerData, {
      generateId: () => globalThis.crypto.randomUUID(),
      now: () => timeSnapshot.now.toISOString(),
      todayKey: () => timeSnapshot.todayKey,
    });
    if (!result.ok) {
      setError(result.error);
      setFeedback("");
      return;
    }
    const outcome = onAssetTransferCreated(
      result.assetTransfer,
      timeSnapshot,
    );
    if (outcome !== "applied") {
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message: outcome === "rejected" ? t("assetTransfers.status.ledgerNotWritable") : t("assetTransfers.status.unchanged"),
      });
      setFeedback("");
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("add");
    setFeedback(t("assetTransfers.status.savingAdd"));
    setError(null);
}

type RequestDeleteDeps = {
  armedDelete: ArmedDelete | null;
  clock: LedgerClock;
  disabled: boolean;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  onAssetTransferDeleted: (assetTransferId: string, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  persistedVersion: number;
  setArmedDelete: Dispatch<SetStateAction<ArmedDelete | null>>;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  t: Translate;
};

/**
 * 这个函数处理转账旁边的「删除」按钮。
 * 第一次点只是「准备删除」，第二次点才删。
 * 两次点之间账本有改动，就作废并提示重来。
 * 删之前先问 `validateAssetTransferRemoval` 能不能删。
 * 举例：删掉一笔转入后，后面的卖出会卖空 → 不删，显示原因。
 */
export function doRequestDelete(
  deps: RequestDeleteDeps,
  assetTransferId: string,
) {
  const {
    armedDelete,
    clock,
    disabled,
    ledgerData,
    ledgerEpoch,
    mutationVersion,
    onAssetTransferDeleted,
    persistedVersion,
    setArmedDelete,
    setError,
    setFeedback,
    setPendingMutationVersion,
    setPendingOperation,
    t,
  } = deps;
    if (disabled) return;
    if (armedDelete?.assetTransferId !== assetTransferId) {
      setArmedDelete({
        assetTransferId,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
      });
      setFeedback(t("assetTransfers.status.deleteArmed"));
      setError(null);
      return;
    }
    if (
      armedDelete.ledgerEpoch !== ledgerEpoch ||
      armedDelete.mutationVersion !== mutationVersion ||
      armedDelete.persistedVersion !== persistedVersion
    ) {
      setArmedDelete(null);
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message: t("assetTransfers.status.deleteStale"),
      });
      return;
    }
    const removal = validateAssetTransferRemoval(
      assetTransferId,
      ledgerData,
    );
    if (!removal.ok) {
      setArmedDelete(null);
      setError(removal.error);
      setFeedback("");
      return;
    }
    const timeSnapshot = captureLedgerTime(clock);
    const outcome = onAssetTransferDeleted(assetTransferId, timeSnapshot);
    setArmedDelete(null);
    if (outcome !== "applied") {
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message:
          outcome === "rejected"
            ? t("assetTransfers.status.ledgerNotWritable")
            : t("assetTransfers.status.notFound"),
      });
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("delete");
    setFeedback(t("assetTransfers.status.savingDelete"));
    setError(null);
}
