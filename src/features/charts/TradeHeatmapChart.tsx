"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TradeHeatmapDay } from "./chartDataService";
import {
  buildTradeHeatmapChartOption,
  TRADE_HEATMAP_LEVEL_COLORS,
} from "./chartOptionBuilders";
import { EChart } from "./EChart";
import { useLanguage } from "@/ui";

type OverviewTradeHeatmapProps = Readonly<{
  heatmap: readonly TradeHeatmapDay[];
  selectedTradeDate: string | null;
  onSelectedTradeDateChange: (date: string | null) => void;
  variant?: "overview";
}>;

type HomeTradeHeatmapProps = Readonly<{
  heatmap: readonly TradeHeatmapDay[];
  onLocateDate: (date: string) => void;
  onViewAll: () => void;
  variant: "home";
}>;

type HomeTooltip = Readonly<{
  date: string;
  kind: "activity" | "empty";
}>;

type TooltipPosition = Readonly<{
  left: number;
  top: number;
}>;

const HOME_HEATMAP_COLUMN_COUNT = 53;
const TOOLTIP_EDGE_GAP = 8;

export function TradeHeatmapChart(
  props: OverviewTradeHeatmapProps | HomeTradeHeatmapProps,
) {
  return props.variant === "home" ? (
    <HomeTradeHeatmap {...props} />
  ) : (
    <OverviewTradeHeatmap {...props} />
  );
}

function OverviewTradeHeatmap({
  heatmap,
  selectedTradeDate,
  onSelectedTradeDateChange,
}: OverviewTradeHeatmapProps) {
  const { t } = useLanguage();
  const option = useMemo(
    () => buildTradeHeatmapChartOption(heatmap, t),
    [heatmap, t],
  );
  const events = useMemo(
    () => ({
      click: (params: unknown) => {
        const date = readHeatmapDate(params);
        if (!date) return;
        onSelectedTradeDateChange(
          selectedTradeDate === date ? null : date,
        );
      },
    }),
    [onSelectedTradeDateChange, selectedTradeDate],
  );
  const totalTrades = heatmap.reduce((total, day) => total + day.total, 0);

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4 min-[1100px]:p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ledger-ink)]">
            {t("charts.heatmap.overview.heading")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ledger-muted)]">
            {t("charts.heatmap.overview.descriptionPrefix")} {heatmap.length}{" "}
            {t("charts.heatmap.overview.daysSuffix")}{t("charts.heatmap.overview.listSeparator")}{totalTrades}{" "}
            {t("charts.heatmap.overview.tradesSuffix")}
          </p>
        </div>
        {selectedTradeDate ? (
          <button
            className="rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ledger-muted)]"
            onClick={() => onSelectedTradeDateChange(null)}
            type="button"
          >
            {t("charts.heatmap.overview.clearSelection")}
          </button>
        ) : null}
      </div>
      <EChart
        ariaLabel={t("charts.heatmap.overview.ariaLabel")}
        className="mt-3 h-56 w-full"
        events={events}
        option={option}
      />
      <p className="text-sm leading-6 text-[var(--ledger-muted)]">
        {t("charts.heatmap.overview.levels")} {" "}
        {selectedTradeDate
          ? `${t("charts.heatmap.overview.selectedPrefix")} ${selectedTradeDate} ${t("charts.heatmap.overview.selectedSuffix")}`
          : t("charts.heatmap.overview.idleHint")}
      </p>
    </article>
  );
}

function HomeTradeHeatmap({
  heatmap,
  onLocateDate,
  onViewAll,
}: HomeTradeHeatmapProps) {
  const { t } = useLanguage();
  const cardRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dayButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [tooltip, setTooltip] = useState<HomeTooltip | null>(null);
  const [tooltipPosition, setTooltipPosition] =
    useState<TooltipPosition>({ left: TOOLTIP_EDGE_GAP, top: TOOLTIP_EDGE_GAP });
  const firstDayRow = getMondayDayRow(heatmap[0]?.date ?? "1970-01-05");
  const tooltipDay = tooltip
    ? heatmap.find((day) => day.date === tooltip.date)
    : undefined;

  useLayoutEffect(() => {
    if (!tooltip) return;
    const card = cardRef.current;
    const tooltipNode = tooltipRef.current;
    const dayButton = dayButtonRefs.current.get(tooltip.date);
    if (!card || !tooltipNode || !dayButton) return;

    const cardRect = card.getBoundingClientRect();
    const dayRect = dayButton.getBoundingClientRect();
    const tooltipRect = tooltipNode.getBoundingClientRect();
    const anchorCenter = dayRect.left - cardRect.left + dayRect.width / 2;
    const preferredLeft = anchorCenter - tooltipRect.width / 2;
    const maximumLeft = Math.max(
      TOOLTIP_EDGE_GAP,
      cardRect.width - tooltipRect.width - TOOLTIP_EDGE_GAP,
    );
    const preferredTop = dayRect.top - cardRect.top - tooltipRect.height - 8;
    const fallbackTop = dayRect.bottom - cardRect.top + 8;

    setTooltipPosition({
      left: clamp(preferredLeft, TOOLTIP_EDGE_GAP, maximumLeft),
      top: preferredTop >= TOOLTIP_EDGE_GAP ? preferredTop : fallbackTop,
    });
  }, [tooltip]);

  useEffect(() => {
    if (!tooltip) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const activeButton = dayButtonRefs.current.get(tooltip.date);
      if (
        activeButton?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setTooltip(null);
    };
    document.addEventListener("pointerdown", closeFromOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeFromOutside, true);
  }, [tooltip]);

  function closeTooltipForDate(date: string) {
    setTooltip((current) => (current?.date === date ? null : current));
  }

  return (
    <article
      className="relative flex min-w-0 flex-col rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4"
      ref={cardRef}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--ledger-ink)]">
          {t("charts.heatmap.home.heading")}
        </h3>
        <button
          className="shrink-0 text-sm font-semibold text-[var(--ledger-accent-strong)]"
          onClick={onViewAll}
          type="button"
        >
          {t("charts.heatmap.home.viewAll")}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center py-4">
        <div
          aria-label={t("charts.heatmap.home.gridAriaLabel")}
          className="grid aspect-[53/7] w-full gap-[clamp(1px,0.15vw,2px)]"
          role="grid"
          style={{
            gridTemplateColumns: `repeat(${HOME_HEATMAP_COLUMN_COUNT}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          }}
        >
          {heatmap.map((day, index) => {
            const offset = firstDayRow - 1 + index;
            const gridColumn = Math.floor(offset / 7) + 1;
            const gridRow = (offset % 7) + 1;
            return (
              <button
                aria-label={getHomeDayAriaLabel(day, t)}
                className="min-h-0 min-w-0 rounded-[2px] border-0 p-0 transition-[filter,outline] hover:brightness-95 focus-visible:z-10 motion-reduce:transition-none"
                data-heatmap-date={day.date}
                data-heatmap-level={day.level}
                key={day.date}
                onBlur={() => closeTooltipForDate(day.date)}
                onClick={() => {
                  if (day.total === 0) {
                    setTooltip({ date: day.date, kind: "empty" });
                    return;
                  }
                  setTooltip(null);
                  onLocateDate(day.date);
                }}
                onFocus={() => {
                  if (day.total > 0) {
                    setTooltip({ date: day.date, kind: "activity" });
                  }
                }}
                onMouseEnter={() => {
                  setTooltip(
                    day.total > 0
                      ? { date: day.date, kind: "activity" }
                      : null,
                  );
                }}
                onMouseLeave={() => closeTooltipForDate(day.date)}
                ref={(node) => {
                  if (node) dayButtonRefs.current.set(day.date, node);
                  else dayButtonRefs.current.delete(day.date);
                }}
                role="gridcell"
                style={{
                  backgroundColor: TRADE_HEATMAP_LEVEL_COLORS[day.level],
                  gridColumn,
                  gridRow,
                }}
                type="button"
              />
            );
          })}
        </div>
      </div>

      {tooltip && tooltipDay ? (
        <div
          className="pointer-events-none absolute z-30 w-max rounded-xl border border-[var(--ledger-border-strong)] bg-[var(--ledger-ink)] px-3 py-2.5 text-xs leading-5 text-white shadow-lg"
          ref={tooltipRef}
          role="tooltip"
          style={{
            ...tooltipPosition,
            maxWidth: "min(260px, calc(100% - 16px))",
          }}
        >
          <p className="font-semibold">{tooltipDay.date}</p>
          {tooltip.kind === "empty" ? (
            <p className="mt-1 text-white/85">
              {t("charts.heatmap.home.emptyDay")}
            </p>
          ) : (
            <ActivityTooltipContent day={tooltipDay} />
          )}
        </div>
      ) : null}
    </article>
  );
}

function ActivityTooltipContent({ day }: Readonly<{ day: TradeHeatmapDay }>) {
  const { t } = useLanguage();
  const visibleGroups = day.activityGroups.slice(0, 3);
  const hiddenTradeCount = day.activityGroups
    .slice(3)
    .reduce((total, group) => total + group.count, 0);

  return (
    <div className="mt-1 text-white/85">
      <p>
        {t("charts.heatmap.tooltip.totalPrefix")} {day.total}{" "}
        {t("charts.heatmap.tooltip.tradesSuffix")} · {t("charts.heatmap.tooltip.buyPrefix")} {day.buys}{" "}
        {t("charts.heatmap.tooltip.tradesSuffix")} · {t("charts.heatmap.tooltip.sellPrefix")} {day.sells}{" "}
        {t("charts.heatmap.tooltip.tradesSuffix")}
      </p>
      {visibleGroups.map((group) => (
        <p key={`${group.assetSymbol}-${group.type}`}>
          {group.assetSymbol} {group.type === "buy" ? t("charts.heatmap.tooltip.buy") : t("charts.heatmap.tooltip.sell")} ×
          {group.count}
        </p>
      ))}
      {hiddenTradeCount > 0 ? (
        <p>
          {t("charts.heatmap.tooltip.remainingPrefix")} {hiddenTradeCount}{" "}
          {t("charts.heatmap.tooltip.remainingSuffix")}
        </p>
      ) : null}
    </div>
  );
}

function getHomeDayAriaLabel(
  day: TradeHeatmapDay,
  t: (key: Parameters<ReturnType<typeof useLanguage>["t"]>[0]) => string,
): string {
  return day.total === 0
    ? `${day.date}${t("charts.heatmap.home.ariaSeparator")}${t("charts.heatmap.home.emptyDay")}`
    : `${day.date}${t("charts.heatmap.home.ariaSeparator")}${t("charts.heatmap.tooltip.totalPrefix")} ${day.total} ${t("charts.heatmap.tooltip.tradesSuffix")}${t("charts.heatmap.home.ariaSeparator")}${t("charts.heatmap.tooltip.buyPrefix")} ${day.buys} ${t("charts.heatmap.tooltip.tradesSuffix")}${t("charts.heatmap.home.ariaSeparator")}${t("charts.heatmap.tooltip.sellPrefix")} ${day.sells} ${t("charts.heatmap.tooltip.tradesSuffix")}`;
}

function getMondayDayRow(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const sundayBasedDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayBasedDay === 0 ? 7 : sundayBasedDay;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readHeatmapDate(params: unknown): string | undefined {
  if (
    !params ||
    typeof params !== "object" ||
    !("data" in params) ||
    !Array.isArray(params.data) ||
    typeof params.data[0] !== "string"
  ) {
    return undefined;
  }
  return params.data[0];
}
