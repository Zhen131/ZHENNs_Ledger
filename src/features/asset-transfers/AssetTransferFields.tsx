"use client";

import { type ReactNode } from "react";
import type { CustodyLocation } from "@/core/models";
import { type AssetTransferServiceError } from "./assetTransferServiceContract";
import type { Translate } from "./assetTransferPanelHelpers";
import { controlClassName } from "./assetTransferPanelHelpers";

export function Field({
  label,
  error,
  field,
  children,
}: Readonly<{
  label: string;
  error: AssetTransferServiceError | null;
  field: AssetTransferServiceError["field"];
  children: ReactNode;
}>) {
  return (
    <div className="grid gap-1 text-sm font-medium">
      <label className="grid gap-1">
        {label}
        {children}
      </label>
      {error?.field === field ? (
        <span className="font-normal text-red-700" id={`asset-transfer-error-${field}`}>
          {error.message}
        </span>
      ) : null}
    </div>
  );
}

export function LocationSelect({
  describedBy: ariaDescribedBy,
  disabled,
  onChange,
  value,
  t,
}: Readonly<{
  describedBy?: string;
  disabled: boolean;
  onChange: (value: CustodyLocation) => void;
  value: CustodyLocation;
  t: Translate;
}>) {
  return (
    <select
      aria-describedby={ariaDescribedBy}
      className={controlClassName}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as CustodyLocation)}
      value={value}
    >
      <option value="exchange">{t("assetTransfers.location.exchange")}</option>
      <option value="cold-wallet">{t("assetTransfers.location.coldWallet")}</option>
      <option value="cold-wallet-earn">{t("assetTransfers.location.coldWalletEarn")}</option>
    </select>
  );
}
