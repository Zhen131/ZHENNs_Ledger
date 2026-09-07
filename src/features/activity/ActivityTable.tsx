"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { calculateTradeCashImpact } from "@/core/calculations";
import type { CashEvent } from "@/core/models";
import {
  formatWallTimeInTimeZone,
  getLedgerDateKey,
  getLedgerTimeZone,
  isLedgerFactInFuture,
  subtract,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import {
  TradeDeleteControl,
  type TradeDeletePhase,
} from "@/features/trades/ui";
import { LedgerNumber, useLanguage } from "@/ui";
import type { LedgerActivityItem } from "./activityService";

/**
 * Which place a recorded moment is shown in. "recorded" shows it in the place
 * it was recorded in, which is what the ledger stores; "current" shows the same
 * moment on the reader's own clock.
 */
export type ActivityTimeZoneView = "recorded" | "current";

export const DEFAULT_ACTIVITY_TIME_ZONE_VIEW: ActivityTimeZoneView = "recorded";

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
    setLocatedDate(null);
    setLocationMode(null);
    if (!locateRequest) return;
    const target = items.find(
      (item) => getLedgerDateKey(item.occurredAt) === locateRequest.date,
    );
    const targetRow = target ? rowRefs.current.get(target.id) : undefined;
    if (!targetRow) {
      onLocateComplete(locateRequest.requestId, "missing");
      return;
    }

    let cancelled = false;
    let highlightStarted = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollContainer =
      targetRow.closest<HTMLElement>("[data-ledger-scroll-container]") ??
      document;
    const supportsScrollEnd = "onscrollend" in scrollContainer;
    const finish = () => {
      if (cancelled) return;
      setLocatedDate(null);
      setLocationMode(null);
      onLocateComplete(locateRequest.requestId, "found");
    };
    const begin = () => {
      if (cancelled || highlightStarted) return;
      highlightStarted = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      scrollContainer.removeEventListener("scrollend", begin);
      setLocatedDate(locateRequest.date);
      setLocationMode("flashing");
      highlightTimer = setTimeout(finish, 800);
    };
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      targetRow.scrollIntoView?.({ behavior: "auto", block: "center" });
      setLocatedDate(locateRequest.date);
      setLocationMode("static");
      highlightTimer = setTimeout(finish, 1_200);
    } else {
      targetRow.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (supportsScrollEnd) {
        scrollContainer.addEventListener("scrollend", begin, { once: true });
      }
      fallbackTimer = setTimeout(begin, supportsScrollEnd ? 500 : 250);
    }
    return () => {
      cancelled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (highlightTimer !== null) clearTimeout(highlightTimer);
      scrollContainer.removeEventListener("scrollend", begin);
    };
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

function ActivityCell({
  label,
  children,
  className = "",
}: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return (
    <td className={`grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2 break-words py-1 text-[var(--ledger-muted)] sm:table-cell sm:px-3 sm:py-3 ${className}`}>
      <span className="font-medium text-[var(--ledger-muted)] sm:hidden">
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </td>
  );
}

function ActivityDetails({ item }: Readonly<{ item: LedgerActivityItem }>) {
  const { t } = useLanguage();
  if (item.kind === "trade") {
    const cashImpact = calculateTradeCashImpact(item.trade);
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("activity.details.factId")} value={item.trade.id} />
        <Detail
          label={t("activity.details.quantity")}
          value={<LedgerNumber kind="quantity" value={item.trade.quantity} />}
        />
        <Detail
          label={t("activity.details.averagePrice")}
          value={
            <>
              <LedgerNumber kind="money" value={item.trade.price} />{" "}
              {item.trade.currency}
            </>
          }
        />
        <Detail
          label={t("activity.details.totalValue")}
          value={
            <>
              <LedgerNumber kind="money" value={item.trade.totalValue} />{" "}
              {item.trade.currency}
            </>
          }
        />
        <Detail
          label={t("activity.details.actualFee")}
          value={
            <>
              <LedgerNumber
                kind={item.trade.feeCurrency === "USDT" ? "money" : "quantity"}
                value={item.trade.fee}
              />{" "}
              {item.trade.feeCurrency}
            </>
          }
        />
        <Detail label={t("activity.details.platform")} value={item.trade.platform ?? t("activity.details.notFilled")} />
        <Detail
          label={t("activity.details.feeSource")}
          value={
            item.trade.feeRuleId ? `FeeRule ${item.trade.feeRuleId}` : t("activity.details.manual")
          }
        />
        <Detail
          label={t("activity.details.cashImpact")}
          value={cashImpact.ok ? (
            <>
              <LedgerNumber kind="money" value={cashImpact.amount} />{" "}
              {cashImpact.currency} · {cashImpact.kind === "buy-outflow"
                ? t("activity.details.buyOutflow")
                : t("activity.details.sellProceeds")}
            </>
          ) : `${t("activity.details.unreliablePrefix")}${t("activity.details.unreliableSeparator")}${cashImpact.feeCurrency} ${t("activity.details.unconvertedFee")}`}
        />
        <Detail label={t("activity.details.note")} value={item.trade.note ?? t("activity.details.notFilled")} />
        <Detail label={t("activity.details.occurredAt")} value={item.trade.occurredAt} />
        {item.trade.occurredTimeZone ? (
          <Detail
            label={t("activity.details.occurredTimeZone")}
            value={item.trade.occurredTimeZone}
          />
        ) : null}
        <Detail label={t("activity.details.timePrecision")} value={item.trade.timePrecision} />
        <Detail label={t("activity.details.createdAt")} value={item.trade.createdAt} />
        <Detail label={t("activity.details.updatedAt")} value={item.trade.updatedAt} />
      </div>
    );
  }

  const event = item.cashEvent;
  const details: Array<{ label: string; value: ReactNode }> = [
    { label: t("activity.details.factId"), value: event.id },
    { label: t("activity.details.type"), value: cashEventTypeLabel(event, t) },
    { label: t("activity.details.currency"), value: event.currency },
    { label: t("activity.details.occurredAt"), value: event.occurredAt },
    ...(event.occurredTimeZone
      ? [{ label: t("activity.details.occurredTimeZone"), value: event.occurredTimeZone }]
      : []),
    { label: t("activity.details.timePrecision"), value: event.timePrecision },
    ...(event.type === "balance-adjustment"
      ? [
          {
            label: t("activity.details.balanceBefore"),
            value: <><LedgerNumber kind="money" value={event.balanceBefore} /> USDT</>,
          },
          {
            label: t("activity.details.targetBalance"),
            value: <><LedgerNumber kind="money" value={event.targetBalance} /> USDT</>,
          },
          {
            label: t("activity.details.adjustmentAmount"),
            value: <><LedgerNumber kind="money" value={event.adjustmentAmount} /> USDT</>,
          },
        ]
      : [{
          label: t("activity.table.amount"),
          value: <><LedgerNumber kind="money" value={event.amount} /> USDT</>,
        }]),
    { label: t("activity.details.note"), value: event.note ?? t("activity.details.notFilled") },
    { label: t("activity.details.createdAt"), value: event.createdAt },
    { label: t("activity.details.updatedAt"), value: event.updatedAt },
  ];
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {details.map((detail) => (
        <Detail key={detail.label} {...detail} />
      ))}
    </div>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-[var(--ledger-muted)]">{label}</p>
      <p className="mt-1 break-words text-[var(--ledger-ink)]">{value}</p>
    </div>
  );
}

function activityTypeLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return item.kind === "trade"
    ? item.trade.type === "buy"
      ? t("trades.type.buy")
      : t("trades.type.sell")
    : cashEventTypeLabel(item.cashEvent, t);
}

function cashEventTypeLabel(event: CashEvent, t: ReturnType<typeof useLanguage>["t"]): string {
  return {
    deposit: t("cash.type.deposit"), withdrawal: t("cash.type.withdrawal"), "external-expense": t("cash.type.externalExpense"), "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[event.type];
}

function activityAssetLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return item.kind === "trade" ? item.trade.assetSymbol : t("activity.table.cashUsdt");
}

function activityAmountLabel(item: LedgerActivityItem): ReactNode {
  if (item.kind === "trade") {
    return (
      <>
        <LedgerNumber kind="money" value={item.trade.totalValue} />{" "}
        {item.trade.currency}
      </>
    );
  }
  const event = item.cashEvent;
  const delta =
    event.type === "balance-adjustment"
      ? event.adjustmentAmount
      : event.type === "deposit"
        ? event.amount
        : subtract("0", event.amount);
  return <><LedgerNumber kind="money" value={delta} /> USDT</>;
}

function activityDeleteLabel(item: LedgerActivityItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("activity.table.deletePrefix")} ${activityTypeLabel(item, t)} ${activityAssetLabel(item, t)} ${item.occurredAt}`;
}

function activityBadgeClass(item: LedgerActivityItem): string {
  const type = item.kind === "trade" ? item.trade.type : item.cashEvent.type;
  const tone =
    type === "buy" || type === "deposit"
      ? "bg-emerald-50 text-emerald-800"
      : type === "sell" || type === "withdrawal"
        ? "bg-amber-50 text-amber-900"
        : type === "external-expense"
          ? "bg-red-50 text-red-800"
          : "bg-sky-50 text-sky-800";
  return `inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone}`;
}

function getActivityOccurredTimeZone(item: LedgerActivityItem): string | undefined {
  return item.kind === "trade"
    ? item.trade.occurredTimeZone
    : item.cashEvent.occurredTimeZone;
}

/**
 * Renders a moment in the chosen view. Switching views changes nothing but the
 * text: `occurredAt` and `occurredTimeZone` are read, never written.
 *
 * A fact recorded only to the day has no moment to move, so both views show the
 * same date. Converting it would invent a time nobody recorded.
 */
export function formatOccurredAtForView(
  occurredAt: string,
  occurredTimeZone: string | undefined,
  view: ActivityTimeZoneView,
  currentTimeZone: string,
): string {
  if (view === "recorded" || occurredAt.length === 10) {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  let wallTime: string;
  try {
    wallTime = formatWallTimeInTimeZone(instant, currentTimeZone);
  } catch {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  return formatRecordedOccurredAt(wallTime, currentTimeZone);
}

export function formatRecordedOccurredAt(
  occurredAt: string,
  occurredTimeZone?: string,
): string {
  if (occurredAt.length === 10) return occurredAt;

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
    occurredAt,
  );
  if (!match) return occurredAt;

  const [, date, time, rawOffset] = match;
  const offset = rawOffset === "Z" ? "+00:00" : rawOffset;
  const place = occurredTimeZone ? ` · ${occurredTimeZone}` : "";
  return `${date} ${time} (${offset})${place}`;
}
