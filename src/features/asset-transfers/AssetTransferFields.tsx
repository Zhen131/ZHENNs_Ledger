/**
 * 这个文件放转账表单用的两个小组件。
 * 一个是一栏的外框，一个是存放位置下拉框。
 * 表单本身在 `AssetTransferPanelForm.tsx`。
 * 没有特别的决定。
 */
"use client";

import { type ReactNode } from "react";
import type { CustodyLocation } from "@/core/models";
import { type AssetTransferServiceError } from "./assetTransferServiceContract";
import { controlClassName } from "./assetTransferPanelHelpers";
import type { Translate } from "@/ui";

/**
 * 这个组件画表单的一栏：上面是名字，下面是输入框。
 * 错误正好挂在这一栏时，在下面用红字显示。
 */
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

/**
 * 这个组件画存放位置的下拉框。
 * 三个选项：交易所、冷钱包、冷钱包理财。
 */
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
