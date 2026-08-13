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

type OverviewTradeHeatmapProps = Readonly<{
  heatmap: readonly TradeHeatmapDay[];
  selectedTradeDate: string | null;
  onSelectedTradeDateChange: (date: string | null) => void;
  variant?: "overview";
}>;

type HomeTradeHeatmapProps = Readonly<{
  heatmap: readonly TradeHeatmapDay[];
  onSelectedTradeDateChange: (date: string) => void;
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
  const option = useMemo(
    () => buildTradeHeatmapChartOption(heatmap),
    [heatmap],
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
            最近 365 天交易活跃
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ledger-muted)]">
            一周一列、星期为行；共 {heatmap.length} 个自然日、
            {totalTrades} 笔交易。
          </p>
        </div>
        {selectedTradeDate ? (
          <button
            className="rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ledger-muted)]"
            onClick={() => onSelectedTradeDateChange(null)}
            type="button"
          >
            清除日期筛选
          </button>
        ) : null}
      </div>
      <EChart
        ariaLabel="最近 365 天交易活跃热力图"
        className="mt-3 h-56 w-full"
        events={events}
        option={option}
      />
      <p className="text-sm leading-6 text-[var(--ledger-muted)]">
        活跃等级：无交易 / 低 / 较低 / 较高 / 最高。{" "}
        {selectedTradeDate
          ? `当前筛选 ${selectedTradeDate} 的交易，再点同一天可取消。`
          : "点击日期格可筛选交易列表。"}
      </p>
    </article>
  );
}

function HomeTradeHeatmap({
  heatmap,
  onSelectedTradeDateChange,
  onViewAll,
}: HomeTradeHeatmapProps) {
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
          最近 365 天交易活动
        </h3>
        <button
          className="shrink-0 text-sm font-semibold text-[var(--ledger-accent-strong)]"
          onClick={onViewAll}
          type="button"
        >
          查看全部交易
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center py-4">
        <div
          aria-label="最近 365 天交易活动日格"
          className="grid aspect-[53/7] w-full max-w-[636px] gap-[clamp(1px,0.15vw,2px)]"
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
                aria-label={getHomeDayAriaLabel(day)}
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
                  onSelectedTradeDateChange(day.date);
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
            <p className="mt-1 text-white/85">当天无交易</p>
          ) : (
            <ActivityTooltipContent day={tooltipDay} />
          )}
        </div>
      ) : null}
    </article>
  );
}

function ActivityTooltipContent({ day }: Readonly<{ day: TradeHeatmapDay }>) {
  const visibleGroups = day.activityGroups.slice(0, 3);
  const hiddenTradeCount = day.activityGroups
    .slice(3)
    .reduce((total, group) => total + group.count, 0);

  return (
    <div className="mt-1 text-white/85">
      <p>
        共 {day.total} 笔 · 买入 {day.buys} 笔 · 卖出 {day.sells} 笔
      </p>
      {visibleGroups.map((group) => (
        <p key={`${group.assetSymbol}-${group.type}`}>
          {group.assetSymbol} {group.type === "buy" ? "买入" : "卖出"} ×
          {group.count}
        </p>
      ))}
      {hiddenTradeCount > 0 ? <p>另有 {hiddenTradeCount} 笔交易</p> : null}
    </div>
  );
}

function getHomeDayAriaLabel(day: TradeHeatmapDay): string {
  return day.total === 0
    ? `${day.date}，当天无交易`
    : `${day.date}，共 ${day.total} 笔，买入 ${day.buys} 笔，卖出 ${day.sells} 笔`;
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
