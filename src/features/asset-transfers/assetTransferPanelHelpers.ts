import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
} from "@/core/models";
import type { useLanguage } from "@/ui";
import {
  ASSET_TRANSFER_REASONS_BY_CATEGORY,
  type AssetTransferServiceError,
} from "./assetTransferServiceContract";

export const SUCCESS_FEEDBACK_MS = 4_000;
export const DEFAULT_CATEGORY: AssetTransferCategory = "internal";
export const DEFAULT_FROM_LOCATION: CustodyLocation = "exchange";
export const DEFAULT_TO_LOCATION: CustodyLocation = "cold-wallet";
export type Translate = ReturnType<typeof useLanguage>["t"];

export type ArmedDelete = Readonly<{
  assetTransferId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;

export const controlClassName =
  "rounded-md border border-slate-200 px-3 py-2 font-normal";

export function firstReason(category: AssetTransferCategory): AssetTransferReason {
  return ASSET_TRANSFER_REASONS_BY_CATEGORY[category][0];
}

export function describedBy(
  error: AssetTransferServiceError | null,
  field: AssetTransferServiceError["field"],
): string | undefined {
  return error?.field === field ? `asset-transfer-error-${field}` : undefined;
}

export function categoryLabel(category: AssetTransferCategory, t: Translate): string {
  return {
    internal: t("assetTransfers.category.internal"),
    "external-in": t("assetTransfers.category.externalIn"),
    "external-out": t("assetTransfers.category.externalOut"),
    gain: t("assetTransfers.category.gain"),
  }[category];
}

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

export function transferLocationSummary(assetTransfer: AssetTransfer, t: Translate): string {
  if (assetTransfer.category === "internal") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${locationLabel(assetTransfer.toLocation!, t)}`;
  }
  if (assetTransfer.category === "external-out") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${t("assetTransfers.location.outsideLedger")}`;
  }
  return `${t("assetTransfers.location.outsideLedger")} → ${locationLabel(assetTransfer.toLocation!, t)}`;
}
