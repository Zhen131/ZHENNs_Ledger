import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { parse } from "acorn";
import type { BrowserContext, CDPSession, Page } from "playwright";

import { roundDuration } from "./report";

type InstrumentedEvent = Readonly<{
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  detail?: string;
  bytes?: number;
}>;

type CpuProfileNode = Readonly<{
  id: number;
  callFrame: Readonly<{
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  }>;
  children?: readonly number[];
}>;

type CpuProfile = Readonly<{
  nodes: readonly CpuProfileNode[];
  samples?: readonly number[];
  timeDeltas?: readonly number[];
}>;

type TraceEvent = Readonly<{
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts?: number;
  dur?: number;
  args?: Readonly<{ name?: string }>;
}>;

export type M3BreakdownResult = Readonly<{
  totalMs: number;
  browserSubmitToSettledMs: number;
  derivedCpuMs: number;
  persistenceOperationMs: number;
  persistencePrimitiveMs: number;
  repaintCpuMs: number;
  finalRepaintWallMs: number;
  sumMs: number;
  residualMs: number;
  persistenceEvents: readonly InstrumentedEvent[];
  derivedProfileFunctions: readonly Readonly<{
    functionName: string;
    sampledMs: number;
  }>[];
  topProfileFunctions: readonly Readonly<{
    functionName: string;
    url: string;
    sampledMs: number;
  }>[];
  renderingEvents: readonly Readonly<{
    name: string;
    durationMs: number;
  }>[];
}>;

type ProfilingSession = Readonly<{
  session: CDPSession;
  tracingComplete: Promise<string>;
}>;

const DERIVED_FUNCTIONS = new Set([
  "updateDashboardDerivationsForAppend",
  "buildLedgerProjection",
  "buildLedgerPnlSummary",
  "buildHoldingAllocation",
  "buildHoldingHistory",
  "buildTradeHeatmap",
  "replayPositions",
  "replayUsdtCash",
]);

const DERIVED_MARKERS = new Map<string, readonly string[]>([
  [
    "updateDashboardDerivationsForAppend",
    ['mode:"incremental"', "cashReplay", "positionReplay"],
  ],
  ["buildLedgerProjection", ["MISSING_CURRENT_PRICE", "pricedAssetMarketValue"]],
  ["buildLedgerPnlSummary", ["存在无法换算的手续费", "buyOutflowByAsset"]],
  ["buildHoldingAllocation", ['assetSymbol:"现金 USDT"', "cashDeficit"]],
  ["buildHoldingHistory", ['displayBoundary:"start"', 'displayBoundary:"end"']],
  ["buildTradeHeatmap", ["activityGroups:new Map", "activityGroups:Array.from"]],
  ["replayUsdtCash", [".cashEvents.map", "balanceAfter"]],
]);

const RENDERING_EVENTS = new Set([
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "Layerize",
  "CompositeLayers",
]);

export async function installM3BreakdownInstrumentation(
  page: Page,
  fileName = "synthetic-benchmark.lftl",
): Promise<void> {
  await page.evaluate(async (benchmarkFileName) => {
    type MutableEvent = {
      name: string;
      startMs: number;
      endMs: number;
      durationMs: number;
      detail?: string;
      bytes?: number;
    };
    type BenchmarkState = {
      active: boolean;
      submitMs: number | null;
      busyFalseMs: number | null;
      settledMs: number | null;
      events: MutableEvent[];
    };
    type BenchmarkGlobal = typeof globalThis & {
      __lftlM3Breakdown?: BenchmarkState;
    };

    const benchmarkGlobal = globalThis as BenchmarkGlobal;
    const state: BenchmarkState = {
      active: false,
      submitMs: null,
      busyFalseMs: null,
      settledMs: null,
      events: [],
    };
    benchmarkGlobal.__lftlM3Breakdown = state;

    const helpers = {} as {
      record: (
        name: string,
        startMs: number,
        detail?: string,
        bytes?: number,
      ) => void;
    };
    helpers.record = (
      name: string,
      startMs: number,
      detail?: string,
      bytes?: number,
    ): void => {
      if (!state.active) return;
      const endMs = performance.now();
      state.events.push({
        name,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        ...(detail === undefined ? {} : { detail }),
        ...(bytes === undefined ? {} : { bytes }),
      });
    };

    const originalStringify = JSON.stringify.bind(JSON);
    JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
      if (!state.active) {
        return originalStringify(value, ...rest as []);
      }
      const startMs = performance.now();
      const serialized = originalStringify(value, ...rest as []);
      const candidate = value as Record<string, unknown> | null;
      let detail = "other";
      if (candidate && Array.isArray(candidate.trades)) {
        detail = "ledger-data";
      } else if (candidate && candidate.fileFormatVersion === 2) {
        detail = candidate.previous ? "two-generation-ledger-file" : "ledger-file";
      } else if (candidate && candidate.ledgerData) {
        detail = "canonical-payload";
      }
      if (serialized.length >= 100_000 || detail !== "other") {
        helpers.record("json-stringify", startMs, detail, serialized.length);
      }
      return serialized;
    }) as typeof JSON.stringify;

    const subtle = crypto.subtle;
    const originalEncrypt = subtle.encrypt.bind(subtle);
    const encryptDescriptor: PropertyDescriptor = { configurable: true };
    encryptDescriptor.value = async (
      ...args: Parameters<SubtleCrypto["encrypt"]>
    ) => {
        const startMs = performance.now();
        try {
          return await originalEncrypt(...args);
        } finally {
          helpers.record("crypto-encrypt", startMs);
        }
      };
    Object.defineProperty(subtle, "encrypt", encryptDescriptor);
    const originalDecrypt = subtle.decrypt.bind(subtle);
    const decryptDescriptor: PropertyDescriptor = { configurable: true };
    decryptDescriptor.value = async (
      ...args: Parameters<SubtleCrypto["decrypt"]>
    ) => {
        const startMs = performance.now();
        try {
          return await originalDecrypt(...args);
        } finally {
          helpers.record("crypto-decrypt", startMs);
        }
      };
    Object.defineProperty(subtle, "decrypt", decryptDescriptor);

    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(benchmarkFileName, { create: true });
    const handlePrototype = Object.getPrototypeOf(handle) as {
      getFile: (...args: unknown[]) => Promise<File>;
      createWritable: (...args: unknown[]) => Promise<FileSystemWritableFileStream>;
    };
    const originalGetFile = handlePrototype.getFile;
    handlePrototype.getFile = async function (...args: unknown[]) {
      const startMs = performance.now();
      try {
        const file = await originalGetFile.apply(this, args);
        if (state.active) {
          const originalArrayBuffer = file.arrayBuffer.bind(file);
          file.arrayBuffer = async () => {
            const readStartMs = performance.now();
            try {
              return await originalArrayBuffer();
            } finally {
              helpers.record("file-array-buffer", readStartMs, undefined, file.size);
            }
          };
        }
        return file;
      } finally {
        helpers.record("file-get", startMs);
      }
    };
    const originalCreateWritable = handlePrototype.createWritable;
    handlePrototype.createWritable = async function (...args: unknown[]) {
      const startMs = performance.now();
      const writable = await originalCreateWritable.apply(this, args);
      helpers.record("file-create-writable", startMs);
      const originalWrite = writable.write.bind(writable);
      writable.write = async (data) => {
        const writeStartMs = performance.now();
        try {
          return await originalWrite(data);
        } finally {
          const bytes = typeof data === "string" ? data.length : undefined;
          helpers.record("file-write", writeStartMs, undefined, bytes);
        }
      };
      const originalClose = writable.close.bind(writable);
      writable.close = async () => {
        const closeStartMs = performance.now();
        try {
          return await originalClose();
        } finally {
          helpers.record("file-close", closeStartMs);
        }
      };
      return writable;
    };
  }, fileName);
}

export async function armM3BreakdownInstrumentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __lftlM3Breakdown?: {
        active: boolean;
        submitMs: number | null;
        busyFalseMs: number | null;
        settledMs: number | null;
        events: unknown[];
      };
    };
    const state = benchmarkGlobal.__lftlM3Breakdown;
    if (!state) throw new Error("M-3 breakdown instrumentation is not installed");
    state.events = [];
    state.submitMs = null;
    state.busyFalseMs = null;
    state.settledMs = null;
    const form = document.querySelector('[data-benchmark-form="trade"]');
    if (!form) throw new Error("Benchmark trade form was not found");
    form.addEventListener(
      "submit",
      () => {
        state.active = true;
        state.submitMs = performance.now();
        let sawBusy = false;
        const observer = new MutationObserver(() => {
          const busy = form.getAttribute("aria-busy");
          if (busy === "true") {
            sawBusy = true;
            return;
          }
          if (!sawBusy || busy !== "false") return;
          observer.disconnect();
          state.busyFalseMs = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              state.settledMs = performance.now();
              state.active = false;
            }),
          );
        });
        observer.observe(form, { attributes: true, attributeFilter: ["aria-busy"] });
      },
      { capture: true, once: true },
    );
  });
}

export async function markM3Settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const benchmarkGlobal = globalThis as typeof globalThis & {
        __lftlM3Breakdown?: { settledMs: number | null };
      };
      const state = benchmarkGlobal.__lftlM3Breakdown;
      return state !== undefined && state.settledMs !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
}

export async function startM3Profiling(
  context: BrowserContext,
  page: Page,
): Promise<ProfilingSession> {
  const session = await context.newCDPSession(page);
  const tracingComplete = new Promise<string>((resolve, reject) => {
    session.once("Tracing.tracingComplete", (event) => {
      const stream = (event as { stream?: string }).stream;
      if (stream) resolve(stream);
      else reject(new Error("Chrome tracing did not return a stream"));
    });
  });
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  await session.send("Tracing.start", {
    categories: "devtools.timeline",
    transferMode: "ReturnAsStream",
  });
  return { session, tracingComplete };
}

export async function stopM3Profiling(
  profiling: ProfilingSession,
): Promise<Readonly<{ profile: CpuProfile; traceEvents: readonly TraceEvent[] }>> {
  const profileResult = await profiling.session.send("Profiler.stop");
  await profiling.session.send("Tracing.end");
  const stream = await profiling.tracingComplete;
  let serializedTrace = "";
  for (;;) {
    const result = await profiling.session.send("IO.read", { handle: stream });
    serializedTrace += (result as { data: string }).data;
    if ((result as { eof?: boolean }).eof) break;
  }
  await profiling.session.send("IO.close", { handle: stream });
  await profiling.session.detach();
  return {
    profile: (profileResult as { profile: CpuProfile }).profile,
    traceEvents: (JSON.parse(serializedTrace) as { traceEvents: TraceEvent[] }).traceEvents,
  };
}

export async function readM3Breakdown(
  page: Page,
  totalMs: number,
  profile: CpuProfile,
  traceEvents: readonly TraceEvent[],
): Promise<M3BreakdownResult> {
  const state = await page.evaluate(() => {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __lftlM3Breakdown?: {
        submitMs: number | null;
        busyFalseMs: number | null;
        settledMs: number | null;
        events: InstrumentedEvent[];
      };
    };
    return benchmarkGlobal.__lftlM3Breakdown;
  });
  if (
    !state ||
    state.submitMs === null ||
    state.busyFalseMs === null ||
    state.settledMs === null
  ) {
    throw new Error("M-3 breakdown timestamps are incomplete");
  }

  const derivedRanges = await discoverDerivedRanges(profile);
  const cpu = summarizeCpuProfile(profile, derivedRanges);
  const rendering = summarizeRenderingTrace(traceEvents);
  const persistenceEvents = state.events.filter((event) =>
    event.name === "json-stringify" ||
    event.name.startsWith("crypto-") ||
    event.name.startsWith("file-"),
  );
  const persistencePrimitiveMs = unionDuration(persistenceEvents);
  const persistenceOperationMs = enclosingDuration(persistenceEvents);
  const derivedCpuMs = cpu.derivedCpuMs;
  const repaintCpuMs = rendering.totalMs;
  const sumMs = derivedCpuMs + persistenceOperationMs + repaintCpuMs;

  return {
    totalMs: roundDuration(totalMs),
    browserSubmitToSettledMs: roundDuration(state.settledMs - state.submitMs),
    derivedCpuMs: roundDuration(derivedCpuMs),
    persistenceOperationMs: roundDuration(persistenceOperationMs),
    persistencePrimitiveMs: roundDuration(persistencePrimitiveMs),
    repaintCpuMs: roundDuration(repaintCpuMs),
    finalRepaintWallMs: roundDuration(state.settledMs - state.busyFalseMs),
    sumMs: roundDuration(sumMs),
    residualMs: roundDuration(totalMs - sumMs),
    persistenceEvents: persistenceEvents.map((event) => ({
      ...event,
      startMs: roundDuration(event.startMs),
      endMs: roundDuration(event.endMs),
      durationMs: roundDuration(event.durationMs),
    })),
    derivedProfileFunctions: cpu.derivedFunctions,
    topProfileFunctions: cpu.topFunctions,
    renderingEvents: rendering.events,
  };
}

type DerivedSourceRange = Readonly<{
  functionName: string;
  scriptName: string;
  start: number;
  end: number;
  lineStarts: readonly number[];
}>;

function summarizeCpuProfile(
  profile: CpuProfile,
  derivedRanges: readonly DerivedSourceRange[],
): Readonly<{
  derivedCpuMs: number;
  derivedFunctions: readonly Readonly<{
    functionName: string;
    sampledMs: number;
  }>[];
  topFunctions: readonly Readonly<{
    functionName: string;
    url: string;
    sampledMs: number;
  }>[];
}> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const derivedByFunction = new Map<string, number>();
  const topByFunction = new Map<string, { url: string; microseconds: number }>();
  let derivedMicroseconds = 0;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];

  samples.forEach((nodeId, index) => {
    const delta = deltas[index] ?? 0;
    const leaf = nodes.get(nodeId);
    if (!leaf) return;
    const functionName = leaf.callFrame.functionName || "(anonymous)";
    const key = `${functionName}\n${leaf.callFrame.url}`;
    const existing = topByFunction.get(key);
    topByFunction.set(key, {
      url: leaf.callFrame.url,
      microseconds: (existing?.microseconds ?? 0) + delta,
    });

    let current: CpuProfileNode | undefined = leaf;
    let matchedFunction: string | undefined;
    while (current) {
      const sourceMatch = derivedRanges.find((range) =>
        callFrameIsInRange(current!.callFrame, range),
      );
      if (sourceMatch) {
        matchedFunction = sourceMatch.functionName;
        break;
      }
      if (DERIVED_FUNCTIONS.has(current.callFrame.functionName)) {
        matchedFunction = current.callFrame.functionName;
        break;
      }
      const parent = parents.get(current.id);
      current = parent === undefined ? undefined : nodes.get(parent);
    }
    if (matchedFunction) {
      derivedMicroseconds += delta;
      derivedByFunction.set(
        matchedFunction,
        (derivedByFunction.get(matchedFunction) ?? 0) + delta,
      );
    }
  });

  const descending = (left: readonly [string, number], right: readonly [string, number]) =>
    right[1] - left[1];
  return {
    derivedCpuMs: derivedMicroseconds / 1_000,
    derivedFunctions: [...derivedByFunction.entries()]
      .sort(descending)
      .map(([functionName, microseconds]) => ({
        functionName,
        sampledMs: roundDuration(microseconds / 1_000),
      })),
    topFunctions: [...topByFunction.entries()]
      .sort((left, right) => right[1].microseconds - left[1].microseconds)
      .slice(0, 30)
      .map(([key, value]) => ({
        functionName: key.split("\n", 1)[0],
        url: value.url,
        sampledMs: roundDuration(value.microseconds / 1_000),
      })),
  };
}

async function discoverDerivedRanges(
  profile: CpuProfile,
): Promise<readonly DerivedSourceRange[]> {
  const scriptNames = new Set(
    profile.nodes
      .map((node) => scriptName(node.callFrame.url))
      .filter((name): name is string => name !== null),
  );
  const chunkRoot = resolve(process.cwd(), ".next/static/chunks");
  const relativeFiles = await readdir(chunkRoot, { recursive: true });
  const filesByName = new Map(
    relativeFiles
      .filter((file) => file.endsWith(".js"))
      .map((file) => [basename(file), resolve(chunkRoot, file)]),
  );
  const ranges: DerivedSourceRange[] = [];

  for (const name of scriptNames) {
    const path = filesByName.get(name);
    if (!path) continue;
    const source = await readFile(path, "utf8");
    const functions = collectFunctionRanges(source);
    const lineStarts = collectLineStarts(source);
    for (const [functionName, markers] of DERIVED_MARKERS) {
      const candidates = functions.filter(({ start, end }) => {
        const body = source.slice(start, end);
        return markers.every((marker) => body.includes(marker));
      });
      const smallest = candidates.sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      )[0];
      if (smallest) {
        ranges.push({ functionName, scriptName: name, ...smallest, lineStarts });
      }
    }
  }
  return ranges;
}

function collectFunctionRanges(source: string): readonly Readonly<{
  start: number;
  end: number;
}>[] {
  type AstNode = {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
  };
  const root = parse(source, {
    ecmaVersion: "latest",
    sourceType: "script",
  }) as unknown as AstNode;
  const functions: Array<{ start: number; end: number }> = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Partial<AstNode>;
    if (
      typeof node.type !== "string" ||
      typeof node.start !== "number" ||
      typeof node.end !== "number"
    ) {
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      functions.push({ start: node.start, end: node.end });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "start" && key !== "end" && key !== "loc") visit(child);
    }
  };
  visit(root);
  return functions;
}

function collectLineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function callFrameIsInRange(
  callFrame: CpuProfileNode["callFrame"],
  range: DerivedSourceRange,
): boolean {
  if (scriptName(callFrame.url) !== range.scriptName) return false;
  const lineStart = range.lineStarts[callFrame.lineNumber];
  if (lineStart === undefined) return false;
  const offset = lineStart + callFrame.columnNumber;
  return offset >= range.start && offset < range.end;
}

function scriptName(url: string): string | null {
  if (!url.endsWith(".js")) return null;
  try {
    return basename(new URL(url).pathname);
  } catch {
    return basename(url);
  }
}

function summarizeRenderingTrace(traceEvents: readonly TraceEvent[]): Readonly<{
  totalMs: number;
  events: readonly Readonly<{ name: string; durationMs: number }>[];
}> {
  const rendererMainThreads = new Set(
    traceEvents
      .filter(
        (event) =>
          event.ph === "M" &&
          event.name === "thread_name" &&
          event.args?.name === "CrRendererMain",
      )
      .map((event) => `${event.pid}:${event.tid}`),
  );
  const selected = traceEvents.filter(
    (event) =>
      event.ph === "X" &&
      event.ts !== undefined &&
      event.dur !== undefined &&
      rendererMainThreads.has(`${event.pid}:${event.tid}`) &&
      RENDERING_EVENTS.has(event.name),
  );
  const byName = new Map<string, number>();
  for (const event of selected) {
    byName.set(event.name, (byName.get(event.name) ?? 0) + (event.dur ?? 0));
  }
  return {
    totalMs: unionDuration(
      selected.map((event) => ({
        startMs: (event.ts ?? 0) / 1_000,
        endMs: ((event.ts ?? 0) + (event.dur ?? 0)) / 1_000,
      })),
    ),
    events: [...byName.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name, microseconds]) => ({
        name,
        durationMs: roundDuration(microseconds / 1_000),
      })),
  };
}

function unionDuration(
  events: readonly Readonly<{ startMs: number; endMs: number }>[],
): number {
  const intervals = events
    .filter((event) => event.endMs >= event.startMs)
    .map((event) => [event.startMs, event.endMs] as const)
    .sort((left, right) => left[0] - right[0]);
  if (intervals.length === 0) return 0;
  let total = 0;
  let start = intervals[0][0];
  let end = intervals[0][1];
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + end - start;
}

function enclosingDuration(
  events: readonly Readonly<{ startMs: number; endMs: number }>[],
): number {
  if (events.length === 0) return 0;
  return (
    Math.max(...events.map((event) => event.endMs)) -
    Math.min(...events.map((event) => event.startMs))
  );
}
