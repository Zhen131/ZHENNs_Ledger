import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type ChartRange } from "@/features/charts/chartDataService";
import {
  buildHoldingAllocation,
} from "@/features/charts/chartDataServiceAllocation";
import { buildTradeHeatmap } from "@/features/charts/chartDataServiceHeatmap";
import { buildHoldingHistory } from "@/features/charts/chartDataServiceHistory";
import { buildLedgerPnlSummary } from "@/features/portfolio/pnlSummaryService";
import { buildLedgerProjection } from "@/features/portfolio/ledgerProjection";

import {
  DEFAULT_SYNTHETIC_SEED,
  generateSyntheticLedger,
  type SyntheticScale,
} from "../generator/syntheticLedger";

export const DERIVED_SNAPSHOT_SCALES = ["S-100", "S-1K", "S-10K"] as const;

const HISTORY_RANGES = ["1d", "7d", "30d", "365d", "all"] as const;
const SNAPSHOT_DIRECTORY = resolve(
  process.cwd(),
  "benchmarks/snapshots/derived-results",
);

export type DerivedSnapshot = Readonly<{
  kind: "derived-result-snapshot";
  snapshotFormatVersion: 1;
  seed: string;
  scale: SyntheticScale;
  todayKey: string;
  spanDays: number;
  generatedFactCounts: Readonly<{
    assets: number;
    trades: number;
    cashEvents: number;
    assetTransfers: number;
    priceSnapshots: number;
  }>;
  derived: Readonly<{
    projection: ReturnType<typeof buildLedgerProjection>;
    pnlSummary: ReturnType<typeof buildLedgerPnlSummary>;
    allocation: ReturnType<typeof buildHoldingAllocation>;
    history: Readonly<
      Record<ChartRange, ReturnType<typeof buildHoldingHistory>>
    >;
    heatmap: ReturnType<typeof buildTradeHeatmap>;
  }>;
}>;

export type SnapshotComparison = Readonly<{
  equal: boolean;
  expectedSha256: string;
  actualSha256: string;
}>;

export function createDerivedSnapshot(scale: SyntheticScale): DerivedSnapshot {
  const generated = generateSyntheticLedger({
    scale,
    seed: DEFAULT_SYNTHETIC_SEED,
  });
  const { ledgerData, todayKey } = generated;
  const projection = buildLedgerProjection(ledgerData, {
    asOf: todayKey,
    mode: "auto",
  });
  const history = Object.fromEntries(
    HISTORY_RANGES.map((range) => [
      range,
      buildHoldingHistory(ledgerData, {
        todayKey,
        mode: "auto",
        range,
      }),
    ]),
  ) as Record<ChartRange, ReturnType<typeof buildHoldingHistory>>;

  return {
    kind: "derived-result-snapshot",
    snapshotFormatVersion: 1,
    seed: String(generated.seed),
    scale: generated.scale,
    todayKey,
    spanDays: generated.spanDays,
    generatedFactCounts: {
      assets: ledgerData.assets.length,
      trades: ledgerData.trades.length,
      cashEvents: ledgerData.cashEvents.length,
      assetTransfers: ledgerData.assetTransfers.length,
      priceSnapshots: ledgerData.priceSnapshots.length,
    },
    derived: {
      projection,
      pnlSummary: buildLedgerPnlSummary(ledgerData, {
        todayKey,
        mode: "auto",
      }),
      allocation: buildHoldingAllocation(ledgerData, {
        todayKey,
        mode: "auto",
        projection,
      }),
      history,
      heatmap: buildTradeHeatmap(ledgerData, todayKey),
    },
  };
}

export function serializeDerivedSnapshot(snapshot: DerivedSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function compareDerivedSnapshots(
  expected: DerivedSnapshot,
  actual: DerivedSnapshot,
): SnapshotComparison {
  const expectedSerialized = serializeDerivedSnapshot(expected);
  const actualSerialized = serializeDerivedSnapshot(actual);
  return {
    equal: expectedSerialized === actualSerialized,
    expectedSha256: sha256(expectedSerialized),
    actualSha256: sha256(actualSerialized),
  };
}

export function snapshotPath(scale: SyntheticScale): string {
  return resolve(
    SNAPSHOT_DIRECTORY,
    `${DEFAULT_SYNTHETIC_SEED}-${scale}.derived.json`,
  );
}

export async function readFrozenDerivedSnapshot(
  scale: SyntheticScale,
): Promise<DerivedSnapshot> {
  return JSON.parse(await readFile(snapshotPath(scale), "utf8")) as DerivedSnapshot;
}

export async function writeFrozenDerivedSnapshots(): Promise<
  readonly Readonly<{ scale: SyntheticScale; path: string; sha256: string }>[]
> {
  const written = [];
  for (const scale of DERIVED_SNAPSHOT_SCALES) {
    const path = snapshotPath(scale);
    const serialized = serializeDerivedSnapshot(createDerivedSnapshot(scale));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialized, { encoding: "utf8", flag: "wx" });
    written.push({ scale, path, sha256: sha256(serialized) });
  }
  return written;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  if (!process.argv.slice(2).includes("--write")) {
    throw new Error("Pass --write to create the frozen derived-result snapshots");
  }
  void writeFrozenDerivedSnapshots().then((written) => {
    process.stdout.write(`${JSON.stringify(written, null, 2)}\n`);
  });
}
