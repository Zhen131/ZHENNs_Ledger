"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  getLedgerDateKey,
  getLedgerTimeZone,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import {
  type TradeDeletePhase,
} from "@/features/trades/ui";
import { useLanguage } from "@/ui";
import type { LedgerActivityItem } from "./activityService";
import { ActivityDetails } from "./ActivityTableParts";
import { runActivityLocateEffect } from "./activityTableEffects";
import type { ActivityTimeZoneView } from "./activityTimeFormat";
import {
  DEFAULT_ACTIVITY_TIME_ZONE_VIEW,
} from "./activityTimeFormat";
import { ActivityTableRow } from "./ActivityTableRow";
export {
  DEFAULT_ACTIVITY_TIME_ZONE_VIEW,
  formatOccurredAtForView,
  formatRecordedOccurredAt,
} from "./activityTimeFormat";
export type { ActivityTimeZoneView } from "./activityTimeFormat";

export type ActivityDeleteState = Readonly<{
  armedItemId: string | null;
  pendingItemId: string | null;
  pendingPhase: "countdown" | "persisting" | null;
  remainingMs: number;
}>;

export function ActivityTable({
  items,
  sequenceByItemKey,
  todayKey,
  deleteDisabled = false,
  expandedItemId,
  onExpandedItemIdChange,
  deleteState,
  onArmDelete,
  onConfirmDelete,
  onCancelDelete,
  onUndoDelete,
  locateRequest,
  onLocateComplete,
  clock = systemLedgerClock,
}: Readonly<{
  items: readonly LedgerActivityItem[];
  sequenceByItemKey: ReadonlyMap<string, number>;
  todayKey: string;
  deleteDisabled?: boolean;
  expandedItemId: string | null;
  onExpandedItemIdChange: (itemId: string | null) => void;
  deleteState: ActivityDeleteState;
  onArmDelete: (item: LedgerActivityItem) => void;
  onConfirmDelete: (item: LedgerActivityItem) => void;
  onCancelDelete: () => void;
  onUndoDelete: () => void;
  locateRequest: Readonly<{ date: string; requestId: number }> | null;
  onLocateComplete: (
    requestId: number,
    result: "found" | "missing",
  ) => void;
  clock?: LedgerClock;
}>) {
  const { t } = useLanguage();
  const [timeZoneView, setTimeZoneView] = useState<ActivityTimeZoneView>(
    DEFAULT_ACTIVITY_TIME_ZONE_VIEW,
  );
  const currentTimeZone = getLedgerTimeZone(clock);
  const detailButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [locatedDate, setLocatedDate] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<
    "flashing" | "static" | null
  >(null);

  useEffect(() => {
    if (expandedItemId) {
      rowRefs.current.get(expandedItemId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [expandedItemId]);

  useEffect(() => {
    if (!expandedItemId) return;
    const collapseFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const itemId = expandedItemId;
      onExpandedItemIdChange(null);
      requestAnimationFrame(() => detailButtonRefs.current.get(itemId)?.focus());
    };
    document.addEventListener("keydown", collapseFromEscape);
    return () => document.removeEventListener("keydown", collapseFromEscape);
  }, [expandedItemId, onExpandedItemIdChange]);

  useEffect(() => {
    return runActivityLocateEffect(
      {
        items,
        locateRequest,
        onLocateComplete,
        rowRefs,
        setLocatedDate,
        setLocationMode,
      },
    );
  }, [items, locateRequest, onLocateComplete]);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--ledger-border)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] px-4 py-3 text-sm">
        <label
          className="font-medium text-[var(--ledger-muted)]"
          htmlFor="activity-time-zone-view"
        >
          {t("activity.timeZoneView.label")}
        </label>
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 outline-none focus:border-slate-400"
          id="activity-time-zone-view"
          onChange={(event) =>
            setTimeZoneView(event.target.value as ActivityTimeZoneView)
          }
          value={timeZoneView}
        >
          <option value="recorded">{t("activity.timeZoneView.recorded")}</option>
          <option value="current">
            {t("activity.timeZoneView.current")}: {currentTimeZone}
          </option>
        </select>
        <p className="text-[var(--ledger-muted)]">
          {t("activity.timeZoneView.hint")}
        </p>
      </div>
      <table className="block w-full text-left text-sm sm:table">
        <thead className="hidden bg-[var(--ledger-surface-muted)] text-[var(--ledger-muted)] sm:table-header-group">
          <tr>
            <th className="w-12 px-3 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">{t("activity.table.date")}</th>
            <th className="px-3 py-3 font-medium">{t("activity.table.type")}</th>
            <th className="px-3 py-3 font-medium">{t("activity.table.asset")}</th>
            <th className="px-3 py-3 font-medium">{t("activity.table.quantity")}</th>
            <th className="px-3 py-3 font-medium">{t("activity.table.amount")}</th>
            <th className="px-3 py-3 font-medium">{t("activity.table.fee")}</th>
            <th className="w-56 px-4 py-3 font-medium">{t("activity.table.actions")}</th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-[var(--ledger-border)] bg-white sm:table-row-group">
          {items.length === 0 ? (
            <tr className="block sm:table-row">
              <td
                className="block px-4 py-12 text-center text-[var(--ledger-muted)] sm:table-cell"
                colSpan={8}
              >
                {t("activity.table.empty")}
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const sequence =
                sequenceByItemKey.get(`${item.kind}:${item.id}`) ?? "—";
              const expanded = expandedItemId === item.id;
              const isPending = deleteState.pendingItemId === item.id;
              const phase: TradeDeletePhase =
                deleteState.armedItemId === item.id
                  ? "armed"
                  : isPending && deleteState.pendingPhase
                    ? deleteState.pendingPhase
                    : "idle";
              const dateKey = getLedgerDateKey(item.occurredAt);
              const isLocated = locatedDate === dateKey;
              const rowDeleteDisabled =
                deleteDisabled ||
                (deleteState.pendingPhase === "persisting" && !isPending);
              return (
                <Fragment key={`${item.kind}:${item.id}`}>
                  <ActivityTableRow
                    currentTimeZone={currentTimeZone}
                    dateKey={dateKey}
                    deleteState={deleteState}
                    detailButtonRefs={detailButtonRefs}
                    expanded={expanded}
                    isLocated={isLocated}
                    isPending={isPending}
                    item={item}
                    locationMode={locationMode}
                    onArmDelete={onArmDelete}
                    onCancelDelete={onCancelDelete}
                    onConfirmDelete={onConfirmDelete}
                    onExpandedItemIdChange={onExpandedItemIdChange}
                    onUndoDelete={onUndoDelete}
                    phase={phase}
                    rowDeleteDisabled={rowDeleteDisabled}
                    rowRefs={rowRefs}
                    sequence={sequence}
                    t={t}
                    timeZoneView={timeZoneView}
                    todayKey={todayKey}
                  />
                  {expanded ? (
                    <tr className="block bg-[#fbfaf7] sm:table-row">
                      <td className="block px-4 py-4 sm:table-cell" colSpan={8}>
                        <ActivityDetails item={item} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
