"use client";

import { LedgerNumber, PaginationBar } from "@/ui";
import {
  categoryLabel,
  transferLocationSummary,
} from "./assetTransferPanelHelpers";
import type {
  AssetTransfer,
  LedgerData,
} from "@/core/models";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";

export function AssetTransferPanelEventList({
  armedDelete,
  currentPage,
  currentPageAssetTransfers,
  disabled,
  ledgerData,
  orderedAssetTransfers,
  requestDelete,
  setCurrentPage,
  t,
  totalPages,
}: Readonly<{
  armedDelete: Readonly<{ assetTransferId: string; ledgerEpoch: number; mutationVersion: number; persistedVersion: number; }> | null;
  currentPage: number;
  currentPageAssetTransfers: readonly AssetTransfer[];
  disabled: boolean;
  ledgerData: LedgerData;
  orderedAssetTransfers: AssetTransfer[];
  requestDelete: (assetTransferId: string) => void;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  t: Translate;
  totalPages: number;
}>) {
  return (
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
            <PaginationBar
              ariaLabel={t("assetTransfers.pagination.ariaLabel")}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] pt-3 text-sm"
              currentPage={currentPage}
              nextLabel={t("assetTransfers.pagination.next")}
              onNext={() => setCurrentPage((page) => page + 1)}
              onPrevious={() => setCurrentPage((page) => page - 1)}
              previousLabel={t("assetTransfers.pagination.previous")}
              summary={
                <>
                  {t("assetTransfers.pagination.totalPrefix")} {orderedAssetTransfers.length} {t("assetTransfers.pagination.totalSuffix")}{t("assetTransfers.pagination.listSeparator")}{t("assetTransfers.pagination.pagePrefix")} {currentPage} / {totalPages} {t("assetTransfers.pagination.pageSuffix")}
                </>
              }
              totalPages={totalPages}
            />
          </>
        )}
      </div>
  );
}
