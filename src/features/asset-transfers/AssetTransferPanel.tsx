"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  LedgerData,
} from "@/core/models";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  getActivityPageCount,
  getActivityPageItems,
} from "@/features/activity";
import { LedgerNumber, useLanguage } from "@/ui";
import {
  ASSET_TRANSFER_REASONS_BY_CATEGORY,
  createValidatedAssetTransfer,
  validateAssetTransferRemoval,
  type AssetTransferServiceError,
} from "./assetTransferService";

const SUCCESS_FEEDBACK_MS = 4_000;
const DEFAULT_CATEGORY: AssetTransferCategory = "internal";
const DEFAULT_FROM_LOCATION: CustodyLocation = "exchange";
const DEFAULT_TO_LOCATION: CustodyLocation = "cold-wallet";
type Translate = ReturnType<typeof useLanguage>["t"];

type ArmedDelete = Readonly<{
  assetTransferId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;

export function AssetTransferPanel({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  isWritable,
  onAssetTransferCreated,
  onAssetTransferDeleted,
}: Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  isWritable: boolean;
  onAssetTransferCreated: (
    assetTransfer: AssetTransfer,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onAssetTransferDeleted: (
    assetTransferId: string,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
}>) {
  const { t } = useLanguage();
  const savedFeedback = t("assetTransfers.status.certifiedSaved");
  const deletedFeedback = t("assetTransfers.status.deleted");
  const initialTodayKey = captureLedgerTime(clock).todayKey;
  const [category, setCategory] =
    useState<AssetTransferCategory>(DEFAULT_CATEGORY);
  const [assetSymbol, setAssetSymbol] = useState(
    ledgerData.assets[0]?.symbol ?? "",
  );
  const [reason, setReason] = useState<AssetTransferReason>(
    firstReason(DEFAULT_CATEGORY),
  );
  const [quantity, setQuantity] = useState("");
  const [occurredAt, setOccurredAt] = useState(initialTodayKey);
  const [unitPrice, setUnitPrice] = useState("");
  const [networkFee, setNetworkFee] = useState("");
  const [fromLocation, setFromLocation] = useState<CustodyLocation>(
    DEFAULT_FROM_LOCATION,
  );
  const [toLocation, setToLocation] = useState<CustodyLocation>(
    DEFAULT_TO_LOCATION,
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<AssetTransferServiceError | null>(null);
  const [feedback, setFeedback] = useState("");
  const [armedDelete, setArmedDelete] = useState<ArmedDelete | null>(null);
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const [pendingOperation, setPendingOperation] = useState<
    "add" | "delete" | null
  >(null);
  const [currentPage, setCurrentPage] = useState(1);
  const disabled = !isWritable || pendingMutationVersion !== null;
  const orderedAssetTransfers = [...ledgerData.assetTransfers].reverse();
  const totalPages = getActivityPageCount(orderedAssetTransfers.length);
  const currentPageAssetTransfers = getActivityPageItems(
    orderedAssetTransfers,
    currentPage,
  );

  useEffect(() => {
    setCategory(DEFAULT_CATEGORY);
    setAssetSymbol(ledgerData.assets[0]?.symbol ?? "");
    setReason(firstReason(DEFAULT_CATEGORY));
    setQuantity("");
    setOccurredAt(captureLedgerTime(clock).todayKey);
    setUnitPrice("");
    setNetworkFee("");
    setFromLocation(DEFAULT_FROM_LOCATION);
    setToLocation(DEFAULT_TO_LOCATION);
    setNote("");
    setError(null);
    setFeedback("");
    setArmedDelete(null);
    setPendingMutationVersion(null);
    setPendingOperation(null);
    setCurrentPage(1);
  }, [clock, ledgerEpoch, ledgerData.assets]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (
      assetSymbol !== "" &&
      ledgerData.assets.some((asset) => asset.symbol === assetSymbol)
    ) {
      return;
    }
    setAssetSymbol(ledgerData.assets[0]?.symbol ?? "");
  }, [assetSymbol, ledgerData.assets]);

  useEffect(() => {
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
  }, [deletedFeedback, pendingMutationVersion, pendingOperation, persistedVersion, persistenceStatus, savedFeedback, t]);

  useEffect(() => {
    if (feedback !== savedFeedback && feedback !== deletedFeedback) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [deletedFeedback, feedback, savedFeedback]);

  function handleCategoryChange(nextCategory: AssetTransferCategory) {
    setCategory(nextCategory);
    setReason(firstReason(nextCategory));
    setUnitPrice("");
    setNetworkFee("");
    setFromLocation(DEFAULT_FROM_LOCATION);
    setToLocation(DEFAULT_TO_LOCATION);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const timeSnapshot = captureLedgerTime(clock);
    const common = {
      category,
      assetSymbol,
      reason,
      quantity,
      occurredAt,
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

  function requestDelete(assetTransferId: string) {
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

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="font-semibold">{t("assetTransfers.heading")}</h3>
        <p className="mt-1 text-xs text-[var(--ledger-muted)]">
          {t("assetTransfers.description")}
        </p>
      </div>

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

      <div>
        <h4 className="text-sm font-semibold">{t("assetTransfers.events.heading")}</h4>
        {ledgerData.assetTransfers.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ledger-muted)]">
            {t("assetTransfers.events.empty")}
          </p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {currentPageAssetTransfers.map((assetTransfer) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                  key={assetTransfer.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {categoryLabel(assetTransfer.category, t)} ·{" "}
                      {assetTransfer.assetSymbol} ·{" "}
                      {assetTransfer.occurredAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-600">
                      {t("assetTransfers.field.quantity")} <LedgerNumber kind="quantity" value={assetTransfer.quantity} /> ·{" "}
                      {transferLocationSummary(assetTransfer, t)}
                      {assetTransfer.networkFee !== undefined ? (
                        <>
                          {" "}· {t("assetTransfers.networkFeeShort")}{" "}
                          <LedgerNumber kind="quantity" value={assetTransfer.networkFee} />{" "}
                          {assetTransfer.assetSymbol}
                        </>
                      ) : null}
                      {assetTransfer.unitPrice !== undefined ? (
                        <>
                          {" "}· {t("assetTransfers.unitPriceShort")}{" "}
                          <LedgerNumber kind="money" value={assetTransfer.unitPrice} /> USDT
                        </>
                      ) : null}
                      {assetTransfer.note ? ` · ${assetTransfer.note}` : ""}
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => requestDelete(assetTransfer.id)}
                    type="button"
                  >
                    {armedDelete?.assetTransferId === assetTransfer.id
                      ? t("assetTransfers.action.confirmDelete")
                      : t("assetTransfers.action.delete")}
                  </button>
                </li>
              ))}
            </ul>
            <div
              aria-label={t("assetTransfers.pagination.ariaLabel")}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] pt-3 text-sm"
            >
              <p className="text-[var(--ledger-muted)]">
                {t("assetTransfers.pagination.totalPrefix")} {orderedAssetTransfers.length} {t("assetTransfers.pagination.totalSuffix")}，{t("assetTransfers.pagination.pagePrefix")} {currentPage} / {totalPages} {t("assetTransfers.pagination.pageSuffix")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((page) => page - 1)}
                  type="button"
                >
                  {t("assetTransfers.pagination.previous")}
                </button>
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((page) => page + 1)}
                  type="button"
                >
                  {t("assetTransfers.pagination.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const controlClassName =
  "rounded-md border border-slate-200 px-3 py-2 font-normal";

function Field({
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

function LocationSelect({
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

function firstReason(category: AssetTransferCategory): AssetTransferReason {
  return ASSET_TRANSFER_REASONS_BY_CATEGORY[category][0];
}

function describedBy(
  error: AssetTransferServiceError | null,
  field: AssetTransferServiceError["field"],
): string | undefined {
  return error?.field === field ? `asset-transfer-error-${field}` : undefined;
}

function categoryLabel(category: AssetTransferCategory, t: Translate): string {
  return {
    internal: t("assetTransfers.category.internal"),
    "external-in": t("assetTransfers.category.externalIn"),
    "external-out": t("assetTransfers.category.externalOut"),
    gain: t("assetTransfers.category.gain"),
  }[category];
}

function reasonLabel(reason: AssetTransferReason, t: Translate): string {
  return {
    deposit: t("assetTransfers.reason.deposit"), withdrawal: t("assetTransfers.reason.withdrawal"), "internal-move": t("assetTransfers.reason.internalMove"), airdrop: t("assetTransfers.reason.airdrop"), interest: t("assetTransfers.reason.interest"), "platform-gift": t("assetTransfers.reason.platformGift"),
  }[reason];
}

function locationLabel(location: CustodyLocation, t: Translate): string {
  return {
    exchange: t("assetTransfers.location.exchange"), "cold-wallet": t("assetTransfers.location.coldWallet"), "cold-wallet-earn": t("assetTransfers.location.coldWalletEarn"),
  }[location];
}

function transferLocationSummary(assetTransfer: AssetTransfer, t: Translate): string {
  if (assetTransfer.category === "internal") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${locationLabel(assetTransfer.toLocation!, t)}`;
  }
  if (assetTransfer.category === "external-out") {
    return `${locationLabel(assetTransfer.fromLocation!, t)} → ${t("assetTransfers.location.outsideLedger")}`;
  }
  return `${t("assetTransfers.location.outsideLedger")} → ${locationLabel(assetTransfer.toLocation!, t)}`;
}
