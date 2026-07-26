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

export type EChartEventHandlers = Readonly<
  Record<string, (params: unknown) => void>
>;

type EChartProps = {
  option: EChartsCoreOption;
  ariaLabel: string;
  className?: string;
  events?: EChartEventHandlers;
};

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
