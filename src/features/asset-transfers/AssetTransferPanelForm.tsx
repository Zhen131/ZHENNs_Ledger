"use client";

import type {
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  LedgerData,
} from "@/core/models";
import {
  FACT_TIME_ZONE_OPTIONS,
  getLedgerTimeZone,
} from "@/core/shared";
import { ASSET_TRANSFER_REASONS_BY_CATEGORY } from "./assetTransferServiceContract";
import {
  Field,
  LocationSelect,
} from "./AssetTransferFields";
import {
  controlClassName,
  describedBy,
  reasonLabel,
} from "./assetTransferPanelHelpers";
import type { LedgerClock } from "@/core/shared";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";
import type { AssetTransferServiceError } from "./assetTransferServiceContract";

export function AssetTransferPanelForm({
  assetSymbol,
  category,
  clock,
  disabled,
  error,
  feedback,
  fromLocation,
  handleCategoryChange,
  handleSubmit,
  ledgerData,
  networkFee,
  note,
  occurredAt,
  occurredTime,
  occurredTimeZone,
  pendingOperation,
  quantity,
  reason,
  setAssetSymbol,
  setError,
  setFromLocation,
  setNetworkFee,
  setNote,
  setOccurredAt,
  setOccurredTime,
  setOccurredTimeZone,
  setQuantity,
  setReason,
  setToLocation,
  setUnitPrice,
  t,
  toLocation,
  unitPrice,
}: Readonly<{
  assetSymbol: string;
  category: AssetTransferCategory;
  clock: LedgerClock;
  disabled: boolean;
  error: AssetTransferServiceError | null;
  feedback: string;
  fromLocation: CustodyLocation;
  handleCategoryChange: (nextCategory: AssetTransferCategory) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  ledgerData: LedgerData;
  networkFee: string;
  note: string;
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  pendingOperation: "add" | "delete" | null;
  quantity: string;
  reason: AssetTransferReason;
  setAssetSymbol: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFromLocation: Dispatch<SetStateAction<CustodyLocation>>;
  setNetworkFee: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setOccurredAt: Dispatch<SetStateAction<string>>;
  setOccurredTime: Dispatch<SetStateAction<string>>;
  setOccurredTimeZone: Dispatch<SetStateAction<string>>;
  setQuantity: Dispatch<SetStateAction<string>>;
  setReason: Dispatch<SetStateAction<AssetTransferReason>>;
  setToLocation: Dispatch<SetStateAction<CustodyLocation>>;
  setUnitPrice: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
  toLocation: CustodyLocation;
  unitPrice: string;
}>) {
  return (
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <Field label={t("assetTransfers.field.category")} error={error} field="category">
          <select
            aria-describedby={describedBy(error, "category")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) =>
              handleCategoryChange(event.target.value as AssetTransferCategory)
            }
            value={category}
          >
            <option value="internal">{t("assetTransfers.category.internal")}</option>
            <option value="external-in">{t("assetTransfers.category.externalIn")}</option>
            <option value="external-out">{t("assetTransfers.category.externalOut")}</option>
            <option value="gain">{t("assetTransfers.category.gain")}</option>
          </select>
        </Field>
        <Field label={t("assetTransfers.field.asset")} error={error} field="assetSymbol">
          <select
            aria-describedby={describedBy(error, "assetSymbol")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setAssetSymbol(event.target.value);
              setError(null);
            }}
            value={assetSymbol}
          >
            {ledgerData.assets.map((asset) => (
              <option key={asset.id} value={asset.symbol}>
                {asset.symbol} · {asset.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("assetTransfers.field.reason")} error={error} field="reason">
          <select
            aria-describedby={describedBy(error, "reason")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setReason(event.target.value as AssetTransferReason);
              setError(null);
            }}
            value={reason}
          >
            {ASSET_TRANSFER_REASONS_BY_CATEGORY[category].map((value) => (
              <option key={value} value={value}>
                {reasonLabel(value, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("assetTransfers.field.quantity")} error={error} field="quantity">
          <input
            aria-describedby={describedBy(error, "quantity")}
            className={controlClassName}
            disabled={disabled}
            inputMode="decimal"
            onChange={(event) => {
              setQuantity(event.target.value);
              setError(null);
            }}
            placeholder="2"
            value={quantity}
          />
        </Field>

        {category === "internal" || category === "external-out" ? (
          <Field label={t("assetTransfers.field.fromLocation")} error={error} field="fromLocation">
            <LocationSelect
              describedBy={describedBy(error, "fromLocation")}
              disabled={disabled}
              onChange={(value) => {
                setFromLocation(value);
                setError(null);
              }}
              value={fromLocation} t={t}
            />
          </Field>
        ) : null}
        {category === "internal" ||
        category === "external-in" ||
        category === "gain" ? (
          <Field label={t("assetTransfers.field.toLocation")} error={error} field="toLocation">
            <LocationSelect
              describedBy={describedBy(error, "toLocation")}
              disabled={disabled}
              onChange={(value) => {
                setToLocation(value);
                setError(null);
              }}
              value={toLocation} t={t}
            />
          </Field>
        ) : null}
        {category === "external-in" || category === "gain" ? (
          <Field
            label={t("assetTransfers.field.unitPrice")}
            error={error}
            field="unitPrice"
          >
            <input
              aria-describedby={describedBy(error, "unitPrice")}
              className={controlClassName}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) => {
                setUnitPrice(event.target.value);
                setError(null);
              }}
              placeholder="4"
              value={unitPrice}
            />
          </Field>
        ) : null}
        {category === "internal" || category === "external-out" ? (
          <Field
            label={t("assetTransfers.field.networkFee")}
            error={error}
            field="networkFee"
          >
            <input
              aria-describedby={describedBy(error, "networkFee")}
              className={controlClassName}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) => {
                setNetworkFee(event.target.value);
                setError(null);
              }}
              placeholder="0.001"
              value={networkFee}
            />
          </Field>
        ) : null}
        <Field label={t("assetTransfers.field.date")} error={error} field="occurredAt">
          <input
            aria-describedby={describedBy(error, "occurredAt")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setOccurredAt(event.target.value);
              setError(null);
            }}
            type="date"
            value={occurredAt}
          />
        </Field>
        <Field label={t("assetTransfers.field.time")} error={null} field="occurredAt">
          <input
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setOccurredTime(event.target.value);
              setError(null);
            }}
            type="time"
            value={occurredTime}
          />
        </Field>
        <Field label={t("assetTransfers.field.timeZone")} error={null} field="occurredAt">
          <select
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setOccurredTimeZone(event.target.value);
              setError(null);
            }}
            value={occurredTimeZone}
          >
            <option value={getLedgerTimeZone(clock)}>
              {t("assetTransfers.timeZone.device")}: {getLedgerTimeZone(clock)}
            </option>
            {FACT_TIME_ZONE_OPTIONS.filter(
              (timeZone) => timeZone !== getLedgerTimeZone(clock),
            ).map((timeZone) => (
              <option key={timeZone} value={timeZone}>
                {timeZone}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("assetTransfers.field.note")} error={error} field="note">
          <input
            aria-describedby={describedBy(error, "note")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) => {
              setNote(event.target.value);
              setError(null);
            }}
            value={note}
          />
        </Field>
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={disabled}
            type="submit"
          >
            {pendingOperation === "add"
              ? t("assetTransfers.status.saving")
              : t("assetTransfers.action.save")}
          </button>
          <div aria-live="polite" className="mt-2 min-h-5 text-sm">
            {error?.field === "form" ? (
              <p className="text-red-700" id="asset-transfer-error-form">
                {error.message}
              </p>
            ) : null}
            {error === null && feedback ? (
              <p className="text-sky-800">{feedback}</p>
            ) : null}
          </div>
        </div>
      </form>
  );
}
