/**
 * 这个文件管交易表里的一行，加上它展开后的详情。
 * 整张表在 `ActivityTable.tsx`，删除按钮在 trades 功能区的 `TradeDeleteControl`。
 * 没有特别的决定。
 */
"use client";

import { isLedgerFactInFuture } from "@/core/shared";
import { TradeDeleteControl } from "@/features/trades/ui";
import { LedgerNumber } from "@/ui";
import {
  activityTypeLabel,
  activityAssetLabel,
  activityAmountLabel,
  activityDeleteLabel,
  activityBadgeClass,
  getActivityOccurredTimeZone,
} from "./activityTableLabels";
import { ActivityCell } from "./ActivityTableParts";
import { formatOccurredAtForView } from "./activityTimeFormat";
import type { RefObject } from "react";
import type { LedgerActivityItem } from "./activityService";
import type { TradeDeletePhase } from "@/features/trades/ui";
import type { Translate } from "@/ui";
import type { ActivityTimeZoneView } from "./activityTimeFormat";

/**
 * 这个组件画交易表的一行。
 * 有编号、日期、类型、币、金额、删除按钮。
 * 可以展开或收起这一行的详情。
 * 今天以后的记录会标出来。
 * 正在被删的那一行会显示倒计时和「撤回」。
 */
export function ActivityTableRow({
  currentTimeZone,
  dateKey,
  deleteState,
  detailButtonRefs,
  expanded,
  isLocated,
  isPending,
  item,
  locationMode,
  onArmDelete,
  onCancelDelete,
  onConfirmDelete,
  onExpandedItemIdChange,
  onUndoDelete,
  phase,
  rowDeleteDisabled,
  rowRefs,
  sequence,
  t,
  timeZoneView,
  todayKey,
}: Readonly<{
  currentTimeZone: string;
  dateKey: string;
  deleteState: Readonly<{ armedItemId: string | null; pendingItemId: string | null; pendingPhase: "countdown" | "persisting" | null; remainingMs: number; }>;
  detailButtonRefs: RefObject<Map<string, HTMLButtonElement>>;
  expanded: boolean;
  isLocated: boolean;
  isPending: boolean;
  item: LedgerActivityItem;
  locationMode: "flashing" | "static" | null;
  onArmDelete: (item: LedgerActivityItem) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (item: LedgerActivityItem) => void;
  onExpandedItemIdChange: (itemId: string | null) => void;
  onUndoDelete: () => void;
  phase: TradeDeletePhase;
  rowDeleteDisabled: boolean;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  sequence: number | "—";
  t: Translate;
  timeZoneView: ActivityTimeZoneView;
  todayKey: string;
}>) {
  return (
                  <tr
                    aria-expanded={expanded}
                    className={`grid min-w-0 gap-2 p-3 sm:table-row sm:p-0 ${
                      isPending ? "bg-slate-50 opacity-70" : "hover:bg-[#fbfaf7]"
                    } ${
                      isLocated
                        ? locationMode === "static"
                          ? "ledger-trade-locate-static"
                          : "ledger-trade-locate-flash"
                        : ""
                    } cursor-pointer`}
                    data-activity-date={dateKey}
                    data-activity-id={item.id}
                    data-locate-highlight={isLocated ? locationMode : undefined}
                    data-trade-date={item.kind === "trade" ? dateKey : undefined}
                    data-trade-id={item.kind === "trade" ? item.id : undefined}
                    onClick={(event) => {
                      if (
                        isPending ||
                        (event.target as HTMLElement).closest(
                          "button, a, input, select",
                        )
                      ) {
                        return;
                      }
                      onExpandedItemIdChange(expanded ? null : item.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        isPending ||
                        (event.target as HTMLElement).closest(
                          "button, a, input, select",
                        ) ||
                        (event.key !== "Enter" && event.key !== " ")
                      ) {
                        return;
                      }
                      event.preventDefault();
                      onExpandedItemIdChange(expanded ? null : item.id);
                    }}
                    ref={(node) => {
                      if (node) rowRefs.current.set(item.id, node);
                      else rowRefs.current.delete(item.id);
                    }}
                    tabIndex={isPending ? -1 : 0}
                  >
                    <ActivityCell className="sm:w-12" label={t("activity.table.sequence")}>
                      <span data-activity-sequence>{sequence}</span>
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.date")}>
                      {formatOccurredAtForView(
                        item.occurredAt,
                        getActivityOccurredTimeZone(item),
                        timeZoneView,
                        currentTimeZone,
                      )}
                      {isLedgerFactInFuture(item.occurredAt, todayKey) ? (
                        <span className="ml-2 font-medium text-red-700">
                          {t("activity.table.futureFact")}
                        </span>
                      ) : null}
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.type")}>
                      <span className={activityBadgeClass(item)}>
                        {activityTypeLabel(item, t)}
                      </span>
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.asset")}>
                      <strong>{activityAssetLabel(item, t)}</strong>
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.quantity")}>
                      {item.kind === "trade" ? (
                        <LedgerNumber kind="quantity" value={item.trade.quantity} />
                      ) : t("activity.table.dash")}
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.amount")}>
                      {activityAmountLabel(item)}
                    </ActivityCell>
                    <ActivityCell label={t("activity.table.fee")}>
                      {item.kind === "trade" ? (
                        <>
                          <LedgerNumber
                            kind={item.trade.feeCurrency === "USDT" ? "money" : "quantity"}
                            value={item.trade.fee}
                          />{" "}
                          {item.trade.feeCurrency}
                        </>
                      ) : t("activity.table.dash")}
                    </ActivityCell>
                    <td className="block min-w-0 py-1 sm:table-cell sm:px-4 sm:py-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        {phase === "idle" ? (
                          <button
                            aria-expanded={expanded}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700"
                            onClick={() =>
                              onExpandedItemIdChange(expanded ? null : item.id)
                            }
                            ref={(node) => {
                              if (node) detailButtonRefs.current.set(item.id, node);
                              else detailButtonRefs.current.delete(item.id);
                            }}
                            type="button"
                          >
                            {t("activity.table.details")}
                          </button>
                        ) : null}
                        <TradeDeleteControl
                          ariaLabel={activityDeleteLabel(item, t)}
                          className={phase === "idle" ? "" : "col-span-2"}
                          disabled={rowDeleteDisabled}
                          onActivate={() =>
                            phase === "armed"
                              ? onConfirmDelete(item)
                              : onArmDelete(item)
                          }
                          onCancel={onCancelDelete}
                          onUndo={onUndoDelete}
                          phase={phase}
                          remainingMs={isPending ? deleteState.remainingMs : 0}
                        />
                      </div>
                    </td>
                  </tr>
  );
}
