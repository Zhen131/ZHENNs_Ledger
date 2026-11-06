/**
 * 这个文件放转账面板共用的默认值、类型和取名函数。
 * 按钮按下后做什么在 `assetTransferPanelActions.ts`。
 * 没有特别的决定。
 */
import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
} from "@/core/models";
import type { Translate } from "@/ui";
import {
  ASSET_TRANSFER_REASONS_BY_CATEGORY,
  type AssetTransferServiceError,
} from "./assetTransferServiceContract";

/** 转账表单的默认分类：内部挪动。 */
export const DEFAULT_CATEGORY: AssetTransferCategory = "internal";
/** 内部挪动默认从哪转出：交易所。 */
export const DEFAULT_FROM_LOCATION: CustodyLocation = "exchange";
/** 内部挪动默认转到哪：冷钱包。 */
export const DEFAULT_TO_LOCATION: CustodyLocation = "cold-wallet";

/**
 * 点过一次「删除」、等第二次点的那笔转账。
 * 还记着当时是哪本账本、第几版，版本一变就作废。
 */
export type ArmedDelete = Readonly<{
  assetTransferId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;

/** 转账表单里输入框和下拉框共用的样式。 */
export const controlClassName =
  "rounded-md border border-slate-200 px-3 py-2 font-normal";

/**
 * 这个函数回答：这个分类默认选哪个原因？
 * 举例：`gain` → 答 `airdrop`。
 * 不会出错。
 */
export function firstReason(category: AssetTransferCategory): AssetTransferReason {
  return ASSET_TRANSFER_REASONS_BY_CATEGORY[category][0];
}

/**
 * 这个函数回答：这一栏要不要指向它下面的错误说明？
 * 错误正好挂在这一栏时，返回错误说明的编号；否则返回空。
 * 举例：错误挂在 `quantity` → 答「asset-transfer-error-quantity」。
 */
export function describedBy(
  error: AssetTransferServiceError | null,
  field: AssetTransferServiceError["field"],
): string | undefined {
  return error?.field === field ? `asset-transfer-error-${field}` : undefined;
}

/** 这个函数回答：这个转账分类在界面上叫什么？按当前语言。 */
export function categoryLabel(category: AssetTransferCategory, t: Translate): string {
  return {
    internal: t("assetTransfers.category.internal"),
    "external-in": t("assetTransfers.category.externalIn"),
    "external-out": t("assetTransfers.category.externalOut"),
    gain: t("assetTransfers.category.gain"),
  }[category];
}

/** 这个函数回答：这个转账原因在界面上叫什么？按当前语言。 */
export function reasonLabel(reason: AssetTransferReason, t: Translate): string {
  return {
    deposit: t("assetTransfers.reason.deposit"), withdrawal: t("assetTransfers.reason.withdrawal"), "internal-move": t("assetTransfers.reason.internalMove"), airdrop: t("assetTransfers.reason.airdrop"), interest: t("assetTransfers.reason.interest"), "platform-gift": t("assetTransfers.reason.platformGift"),
  }[reason];
}

function locationLabel(location: CustodyLocation, t: Translate): string {
  return {
    exchange: t("assetTransfers.location.exchange"), "cold-wallet": t("assetTransfers.location.coldWallet"), "cold-wallet-earn": t("assetTransfers.location.coldWalletEarn"),
  }[location];
}

/**
 * 这个函数回答：这笔转账从哪到哪，用一行字怎么说？
 * 账本外面的那一头写成「账本外」。
 * 举例：外部转出，从冷钱包 → 答「冷钱包 → 账本外」。
 * 不会出错。
 */
export function transferLocationSummary(assetTransfer: AssetTransfer, t: Translate): string {
  if (assetTransfer.category === "internal") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${locationLabel(assetTransfer.toLocation!, t)}`;
  }
  if (assetTransfer.category === "external-out") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${t("assetTransfers.location.outsideLedger")}`;
  }
  return `${t("assetTransfers.location.outsideLedger")} → ${locationLabel(assetTransfer.toLocation!, t)}`;
}
