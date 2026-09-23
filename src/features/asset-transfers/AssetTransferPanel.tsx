"use client";

import { useEffect, useState, type FormEvent } from "react";

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
  getLedgerTimeZone,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  getActivityPageCount,
  getActivityPageItems,
} from "@/features/activity";
import { useLanguage } from "@/ui";
import {
  type AssetTransferServiceError,
} from "./assetTransferService";
import type { ArmedDelete } from "./assetTransferPanelHelpers";
import {
  SUCCESS_FEEDBACK_MS,
  DEFAULT_CATEGORY,
  DEFAULT_FROM_LOCATION,
  DEFAULT_TO_LOCATION,
  firstReason,
} from "./assetTransferPanelHelpers";
import {
  doHandleSubmit,
  doRequestDelete,
  runTransferPersistenceEffect,
} from "./assetTransferPanelActions";
import { AssetTransferPanelEventList } from "./AssetTransferPanelEventList";
import { AssetTransferPanelForm } from "./AssetTransferPanelForm";

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
  const [occurredTime, setOccurredTime] = useState("");
  const [occurredTimeZone, setOccurredTimeZone] = useState(
    getLedgerTimeZone(clock),
  );
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
    setOccurredTime("");
    setOccurredTimeZone(getLedgerTimeZone(clock));
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
    return runTransferPersistenceEffect(
      {
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
      },
    );
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
    return doHandleSubmit(
      {
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
      },
      event,
    );
  }

  function requestDelete(assetTransferId: string) {
    return doRequestDelete(
      {
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
      },
      assetTransferId,
    );
  }

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="font-semibold">{t("assetTransfers.heading")}</h3>
        <p className="mt-1 text-xs text-[var(--ledger-muted)]">
          {t("assetTransfers.description")}
        </p>
      </div>

      <AssetTransferPanelForm
        assetSymbol={assetSymbol}
        category={category}
        clock={clock}
        disabled={disabled}
        error={error}
        feedback={feedback}
        fromLocation={fromLocation}
        handleCategoryChange={handleCategoryChange}
        handleSubmit={handleSubmit}
        ledgerData={ledgerData}
        networkFee={networkFee}
        note={note}
        occurredAt={occurredAt}
        occurredTime={occurredTime}
        occurredTimeZone={occurredTimeZone}
        pendingOperation={pendingOperation}
        quantity={quantity}
        reason={reason}
        setAssetSymbol={setAssetSymbol}
        setError={setError}
        setFromLocation={setFromLocation}
        setNetworkFee={setNetworkFee}
        setNote={setNote}
        setOccurredAt={setOccurredAt}
        setOccurredTime={setOccurredTime}
        setOccurredTimeZone={setOccurredTimeZone}
        setQuantity={setQuantity}
        setReason={setReason}
        setToLocation={setToLocation}
        setUnitPrice={setUnitPrice}
        t={t}
        toLocation={toLocation}
        unitPrice={unitPrice}
      />

      <AssetTransferPanelEventList
        armedDelete={armedDelete}
        currentPage={currentPage}
        currentPageAssetTransfers={currentPageAssetTransfers}
        disabled={disabled}
        ledgerData={ledgerData}
        orderedAssetTransfers={orderedAssetTransfers}
        requestDelete={requestDelete}
        setCurrentPage={setCurrentPage}
        t={t}
        totalPages={totalPages}
      />
    </div>
  );
}
