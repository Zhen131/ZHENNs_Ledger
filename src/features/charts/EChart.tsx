/**
 * 这个文件管一件事：把一份 ECharts 设置画到页面上。
 * 三张图的设置在 `chartOptionBuilders.ts` 里算好再传进来。
 * 没有特别的决定。
 */
"use client";

import {
  useEffect,
  useRef,
} from "react";
import {
  init,
  use as registerEChartsModules,
  type EChartsCoreOption,
  type EChartsType,
} from "echarts/core";
import {
  HeatmapChart,
  LineChart,
  PieChart,
} from "echarts/charts";
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

registerEChartsModules([
  CanvasRenderer,
  PieChart,
  LineChart,
  HeatmapChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CalendarComponent,
  VisualMapComponent,
]);

type EChartEventHandlers = Readonly<
  Record<string, (params: unknown) => void>
>;

type EChartProps = {
  option: EChartsCoreOption;
  ariaLabel: string;
  className?: string;
  events?: EChartEventHandlers;
};

/**
 * 这个组件画一块 ECharts 画布。
 * 能画的只有饼图、折线、热力图三种。
 * 容器大小变了就跟着重画；`option` 变了就换上新设置。
 * `events` 里的点击等事件会挂到图上，换掉时先摘下旧的。
 * 离开页面时把图收掉。
 */
export function EChart({
  option,
  ariaLabel,
  className = "h-80 w-full",
  events = {},
}: Readonly<EChartProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EChartsType | null>(null);
  const eventNamesRef = useRef<string[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const instance = init(container, undefined, { renderer: "canvas" });
    instanceRef.current = instance;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => instance.resize());
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      for (const eventName of eventNamesRef.current) {
        instance.off(eventName);
      }
      eventNamesRef.current = [];
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(
      { ...option, animation: false },
      { notMerge: true, lazyUpdate: false },
    );
  }, [option]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) {
      return;
    }

    for (const eventName of eventNamesRef.current) {
      instance.off(eventName);
    }
    const eventNames = Object.keys(events);
    for (const eventName of eventNames) {
      instance.off(eventName);
      instance.on(eventName, events[eventName]);
    }
    eventNamesRef.current = eventNames;
  }, [events]);

  return (
    <div
      aria-label={ariaLabel}
      className={`min-w-0 max-w-full overflow-hidden ${className}`}
      ref={containerRef}
      role="img"
    />
  );
}
