// @vitest-environment jsdom

import {
  cleanup,
  render,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerEChartsModules: vi.fn(),
  init: vi.fn(),
  setOption: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("echarts/core", () => ({
  use: mocks.registerEChartsModules,
  init: mocks.init,
}));
vi.mock("echarts/charts", () => ({
  HeatmapChart: {},
  LineChart: {},
  PieChart: {},
}));
vi.mock("echarts/components", () => ({
  CalendarComponent: {},
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
vi.mock("echarts/renderers", () => ({
  CanvasRenderer: {},
}));

import { EChart } from "./EChart";

const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.init.mockReturnValue({
    setOption: mocks.setOption,
    on: mocks.on,
    off: mocks.off,
    resize: mocks.resize,
    dispose: mocks.dispose,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EChart lifecycle adapter", () => {
  it("initializes one Canvas instance and fully replaces options on rerender", () => {
    const view = render(
      <EChart
        ariaLabel="Test chart"
        option={{ series: [{ type: "line", data: [1, 2] }] }}
      />,
    );
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.init).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      undefined,
      { renderer: "canvas" },
    );
    expect(mocks.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({
        animation: false,
        series: [{ type: "line", data: [1, 2] }],
      }),
      { notMerge: true, lazyUpdate: false },
    );
    expect(view.getByRole("img").className).toContain("min-w-0");
    expect(view.getByRole("img").className).toContain("overflow-hidden");

    view.rerender(
      <EChart ariaLabel="Test chart" option={{ series: [] }} />,
    );
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.setOption).toHaveBeenLastCalledWith(
      { animation: false, series: [] },
      { notMerge: true, lazyUpdate: false },
    );
  });

  it("fully replaces a 365-day calendar with a one-day view", () => {
    const days = Array.from({ length: 365 }, (_, index) => [
      `2026-01-${String((index % 31) + 1).padStart(2, "0")}`,
      index,
    ]);
    const view = render(
      <EChart
        ariaLabel="Calendar chart"
        option={{
          calendar: [{ range: ["2025-07-26", "2026-07-25"] }],
          series: [{ type: "heatmap", data: days }],
        }}
      />,
    );

    view.rerender(
      <EChart
        ariaLabel="Calendar chart"
        option={{
          calendar: [{ range: "2026-07-25" }],
          series: [{ type: "heatmap", data: [["2026-07-25", 1]] }],
        }}
      />,
    );

    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.setOption).toHaveBeenLastCalledWith(
      {
        animation: false,
        calendar: [{ range: "2026-07-25" }],
        series: [
          { type: "heatmap", data: [["2026-07-25", 1]] },
        ],
      },
      { notMerge: true, lazyUpdate: false },
    );
  });

  it("rebinds events without duplicate handlers", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <EChart
        ariaLabel="Event chart"
        events={{ click: first }}
        option={{}}
      />,
    );
    expect(mocks.off).toHaveBeenCalledWith("click");
    expect(mocks.on).toHaveBeenCalledWith("click", first);

    view.rerender(
      <EChart
        ariaLabel="Event chart"
        events={{ click: second }}
        option={{}}
      />,
    );
    expect(mocks.off.mock.calls.filter(([name]) => name === "click").length).toBe(
      3,
    );
    expect(mocks.on).toHaveBeenLastCalledWith("click", second);
  });

  it("resizes and fully cleans observers, handlers and the instance", () => {
    let resizeCallback!: () => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const view = render(
      <EChart
        ariaLabel="Disposed chart"
        events={{ click: vi.fn() }}
        option={{}}
      />,
    );
    resizeCallback();
    expect(mocks.resize).toHaveBeenCalledOnce();

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(mocks.off).toHaveBeenCalledWith("click");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
