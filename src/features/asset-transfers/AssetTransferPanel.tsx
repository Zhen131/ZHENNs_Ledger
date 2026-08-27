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
import { LedgerNumber } from "@/ui";
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
  const disabled = !isWritable || pendingMutationVersion !== null;

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
  }, [clock, ledgerEpoch, ledgerData.assets]);

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
        message: "资产转移仍在内存中，但尚未保存；请重试保存",
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
        setFeedback("资产转移已认证保存");
      } else {
        setFeedback("资产转移已删除");
      }
      setError(null);
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
  }, [pendingMutationVersion, pendingOperation, persistedVersion, persistenceStatus]);

  useEffect(() => {
    if (!feedback.includes("已")) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [feedback]);

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
        message: outcome === "rejected" ? "账本当前不可写" : "账本未发生变化",
      });
      setFeedback("");
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("add");
    setFeedback("正在保存资产转移…");
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
      setFeedback("再次点击以确认删除该资产转移");
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
        message: "账本已变化，请重新检查后再删除",
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
            ? "账本当前不可写"
            : "资产转移已不存在",
      });
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("delete");
    setFeedback("正在保存删除…");
    setError(null);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="font-semibold">资产转入转出</h3>
        <p className="mt-1 text-xs text-[var(--ledger-muted)]">
          转移与交易合并成同一时间线重放；四类转移都不改变 USDT 现金。
        </p>
      </div>

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <Field label="转移类别" error={error} field="category">
          <select
            aria-describedby={describedBy(error, "category")}
            className={controlClassName}
            disabled={disabled}
            onChange={(event) =>
              handleCategoryChange(event.target.value as AssetTransferCategory)
            }
            value={category}
          >
            <option value="internal">内部转移</option>
            <option value="external-in">外部转入</option>
            <option value="external-out">外部转出</option>
            <option value="gain">白拿</option>
          </select>
        </Field>
        <Field label="资产" error={error} field="assetSymbol">
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
        <Field label="原因" error={error} field="reason">
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
                {reasonLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数量" error={error} field="quantity">
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
          <Field label="来源位置" error={error} field="fromLocation">
            <LocationSelect
              describedBy={describedBy(error, "fromLocation")}
              disabled={disabled}
              onChange={(value) => {
                setFromLocation(value);
                setError(null);
              }}
              value={fromLocation}
            />
          </Field>
        ) : null}
        {category === "internal" ||
        category === "external-in" ||
        category === "gain" ? (
          <Field label="目的位置" error={error} field="toLocation">
            <LocationSelect
              describedBy={describedBy(error, "toLocation")}
              disabled={disabled}
              onChange={(value) => {
                setToLocation(value);
                setError(null);
              }}
              value={toLocation}
            />
          </Field>
        ) : null}
        {category === "external-in" || category === "gain" ? (
          <Field
            label="到账单价（USDT）"
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
            label="链上手续费（资产计价，可选）"
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
        <Field label="日期" error={error} field="occurredAt">
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
        <Field label="备注（可选）" error={error} field="note">
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
              ? "正在保存…"
              : "保存资产转入转出"}
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
        <h4 className="text-sm font-semibold">资产转移事实</h4>
        {ledgerData.assetTransfers.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ledger-muted)]">
            暂无资产转移。
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {[...ledgerData.assetTransfers].reverse().map((assetTransfer) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                key={assetTransfer.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {categoryLabel(assetTransfer.category)} ·{" "}
                    {assetTransfer.assetSymbol} ·{" "}
                    {assetTransfer.occurredAt.slice(0, 10)}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-600">
                    数量 <LedgerNumber kind="quantity" value={assetTransfer.quantity} /> ·{" "}
                    {transferLocationSummary(assetTransfer)}
                    {assetTransfer.networkFee !== undefined ? (
                      <>
                        {" "}· 链上手续费{" "}
                        <LedgerNumber kind="quantity" value={assetTransfer.networkFee} />{" "}
                        {assetTransfer.assetSymbol}
                      </>
                    ) : null}
                    {assetTransfer.unitPrice !== undefined ? (
                      <>
                        {" "}· 到账单价{" "}
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
                    ? "确认删除"
                    : "删除"}
                </button>
              </li>
            ))}
          </ul>
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
}: Readonly<{
  describedBy?: string;
  disabled: boolean;
  onChange: (value: CustodyLocation) => void;
  value: CustodyLocation;
}>) {
  return (
    <select
      aria-describedby={ariaDescribedBy}
      className={controlClassName}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as CustodyLocation)}
      value={value}
    >
      <option value="exchange">交易所</option>
      <option value="cold-wallet">冷钱包</option>
      <option value="cold-wallet-earn">冷钱包理财</option>
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

function categoryLabel(category: AssetTransferCategory): string {
  return {
    internal: "内部转移",
    "external-in": "外部转入",
    "external-out": "外部转出",
    gain: "白拿",
  }[category];
}

function reasonLabel(reason: AssetTransferReason): string {
  return {
    deposit: "存入",
    withdrawal: "提取",
    "internal-move": "内部迁移",
    airdrop: "空投",
    interest: "利息",
    "platform-gift": "平台赠送",
  }[reason];
}

function locationLabel(location: CustodyLocation): string {
  return {
    exchange: "交易所",
    "cold-wallet": "冷钱包",
    "cold-wallet-earn": "冷钱包理财",
  }[location];
}

function transferLocationSummary(assetTransfer: AssetTransfer): string {
  if (assetTransfer.category === "internal") {
    return `${locationLabel(assetTransfer.fromLocation!)} → ${locationLabel(assetTransfer.toLocation!)}`;
  }
  if (assetTransfer.category === "external-out") {
    return `${locationLabel(assetTransfer.fromLocation!)} → 账本外`;
  }
  return `账本外 → ${locationLabel(assetTransfer.toLocation!)}`;
}
