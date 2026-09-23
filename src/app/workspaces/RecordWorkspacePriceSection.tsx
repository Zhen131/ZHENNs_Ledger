"use client";

import { PriceForm } from "@/features/prices/ui";
import { SurfaceCard } from "@/ui";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type { PriceWorkspaceDraft } from "@/features/prices";
import type {
  LedgerData,
  PriceSnapshot,
} from "@/core/models";
import type {
  ReactNode,
  RefObject,
} from "react";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app/persistence";
import type { useLanguage } from "@/ui";

export function RecordWorkspacePriceSection({
  clock,
  commitPriceDraft,
  isWritable,
  ledgerData,
  ledgerEpoch,
  marketDataPanel,
  mutationVersion,
  onPriceSnapshotCreated,
  persistedVersion,
  persistenceStatus,
  priceDraft,
  priceFocusRef,
  resetPriceDraft,
  t,
}: Readonly<{
  clock: LedgerClock;
  commitPriceDraft: (nextDraft: PriceWorkspaceDraft) => void;
  isWritable: boolean;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  marketDataPanel: ReactNode;
  mutationVersion: number;
  onPriceSnapshotCreated: (priceSnapshot: PriceSnapshot, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  priceDraft: PriceWorkspaceDraft;
  priceFocusRef: RefObject<HTMLSelectElement | null>;
  resetPriceDraft: (preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">) => void;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
        <div className="grid min-w-0 content-start gap-4">
          <SurfaceCard className="min-w-0 p-5">
            <div className="mb-4">
              <h3 className="font-semibold">{t("record.price.heading")}</h3>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                {t("record.price.description")}
              </p>
            </div>
            <fieldset
              className={isWritable ? "" : "opacity-60"}
              disabled={!isWritable}
            >
              <PriceForm
                clock={clock}
                draft={priceDraft}
                focusTargetRef={priceFocusRef}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onDraftChange={commitPriceDraft}
                onPriceSnapshotCreated={onPriceSnapshotCreated}
                onReset={resetPriceDraft}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
            </fieldset>
          </SurfaceCard>

          {marketDataPanel ? (
            <SurfaceCard className="min-w-0 p-5">
              {marketDataPanel}
            </SurfaceCard>
          ) : null}
        </div>
  );
}
