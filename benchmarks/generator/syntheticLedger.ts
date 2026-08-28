import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Decimal from "decimal.js";

import type {
  Asset,
  AssetTransfer,
  CashEvent,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import type { BackupEnvelopeV3 } from "@/features/backup/backupEnvelope";

import {
  createDeterministicRng,
  type DeterministicSeed,
} from "./deterministicRng";

export const DEFAULT_SYNTHETIC_SEED = "w15-main-perf-baseline-v1";
export const DEFAULT_SYNTHETIC_TODAY = "2026-08-28";

export const SYNTHETIC_SCALE_TRADE_COUNTS = {
  "S-100": 100,
  "S-1K": 1_000,
  "S-10K": 10_000,
  "S-100K": 100_000,
  "S-1M": 1_000_000,
} as const;

export type SyntheticScale = keyof typeof SYNTHETIC_SCALE_TRADE_COUNTS;

export type SyntheticLedgerOptions = Readonly<{
  scale: SyntheticScale;
  seed?: DeterministicSeed;
  todayKey?: string;
}>;

export type SyntheticLedgerResult = Readonly<{
  ledgerData: LedgerData;
  scale: SyntheticScale;
  seed: DeterministicSeed;
  todayKey: string;
  spanDays: number;
}>;

const FACTS_PER_DAY = 100;
const TRANSFER_CATEGORIES = [
  "external-in",
  "gain",
  "internal",
  "external-out",
] as const;

export function generateSyntheticLedger(
  options: SyntheticLedgerOptions,
): SyntheticLedgerResult {
  const tradeCount = SYNTHETIC_SCALE_TRADE_COUNTS[options.scale];
  const seed = options.seed ?? DEFAULT_SYNTHETIC_SEED;
  const todayKey = options.todayKey ?? DEFAULT_SYNTHETIC_TODAY;
  assertIsoDate(todayKey);

  const rng = createDeterministicRng(seed);
  const assetCount = selectAssetCount(tradeCount);
  const spanDays = Math.max(10, Math.ceil(tradeCount / FACTS_PER_DAY));
  const startKey = addUtcDays(todayKey, -(spanDays - 1));
  const assets = createAssets(assetCount, startKey);

  const ledgerData: LedgerData = {
    schemaVersion: 4,
    assets,
    trades: createTrades(tradeCount, assets, startKey, spanDays, rng),
    cashEvents: createCashEvents(
      Math.round(tradeCount * 0.4),
      tradeCount,
      startKey,
      spanDays,
      rng,
    ),
    assetTransfers: createAssetTransfers(
      Math.round(tradeCount * 0.05),
      assets,
      startKey,
      spanDays,
    ),
    priceSnapshots: createPriceSnapshots(
      Math.round(tradeCount * 0.15),
      assets,
      startKey,
      spanDays,
      rng,
    ),
    feeRules: [],
  };

  return { ledgerData, scale: options.scale, seed, todayKey, spanDays };
}

export function createSyntheticBackupEnvelope(
  result: SyntheticLedgerResult,
): BackupEnvelopeV3 {
  return {
    backupFormatVersion: 3,
    appVersion: "0.1.0-benchmark",
    exportedAt: `${result.todayKey}T12:00:00.000Z`,
    ledgerSchemaVersion: 4,
    ledgerData: result.ledgerData,
  };
}

export function serializeSyntheticBackup(result: SyntheticLedgerResult): string {
  return `${JSON.stringify(createSyntheticBackupEnvelope(result), null, 2)}\n`;
}

export async function withSyntheticBackupFile<T>(
  result: SyntheticLedgerResult,
  run: (filePath: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "lftl-benchmark-"));
  const filePath = join(directory, `${result.scale}.generated.json`);
  try {
    await writeFile(filePath, serializeSyntheticBackup(result), "utf8");
    return await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createAssets(count: number, startKey: string): Asset[] {
  const timestamp = `${startKey}T00:00:00.000Z`;
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return {
      id: `benchmark-asset-${suffix}`,
      symbol: `SIM${suffix}`,
      name: `Synthetic Instrument ${suffix}`,
      quoteCurrency: "USDT",
      decimals: 8,
      binanceMapping: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

function createTrades(
  count: number,
  assets: readonly Asset[],
  startKey: string,
  spanDays: number,
  rng: ReturnType<typeof createDeterministicRng>,
): Trade[] {
  const occurrences = new Array<number>(assets.length).fill(0);

  return Array.from({ length: count }, (_, index) => {
    const assetIndex = index % assets.length;
    const asset = assets[assetIndex];
    const occurrence = occurrences[assetIndex]++;
    const type = occurrence % 5 === 4 ? "sell" : "buy";
    const quantity = String(
      type === "buy" ? rng.integer(6, 12) : rng.integer(1, 3),
    );
    const price = String(20 + assetIndex * 7 + rng.integer(0, 15));
    const totalValue = new Decimal(quantity).mul(price).toString();
    const occurredAt = distributedTimestamp(index, count, startKey, spanDays, 10);

    return {
      id: benchmarkId("trade", index),
      occurredAt,
      timePrecision: "second",
      type,
      assetSymbol: asset.symbol,
      quantity,
      price,
      totalValue,
      currency: "USDT",
      fee: "0",
      feeCurrency: "USDT",
      platform: `Synthetic Venue ${assetIndex % 3 + 1}`,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function createCashEvents(
  count: number,
  tradeCount: number,
  startKey: string,
  spanDays: number,
  rng: ReturnType<typeof createDeterministicRng>,
): CashEvent[] {
  if (count === 0) return [];
  const initialTimestamp = `${startKey}T00:00:01.000Z`;
  const initial: CashEvent = {
    id: benchmarkId("cash", 0),
    occurredAt: initialTimestamp,
    timePrecision: "second",
    type: "deposit",
    currency: "USDT",
    amount: String(tradeCount * 1_000),
    createdAt: initialTimestamp,
    updatedAt: initialTimestamp,
  };

  return [
    initial,
    ...Array.from({ length: count - 1 }, (_, offset) => {
      const index = offset + 1;
      const occurredAt = distributedTimestamp(
        index,
        count,
        startKey,
        spanDays,
        20,
      );
      return {
        id: benchmarkId("cash", index),
        occurredAt,
        timePrecision: "second" as const,
        type: "deposit" as const,
        currency: "USDT" as const,
        amount: String(rng.integer(500, 2_000)),
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
    }),
  ];
}

function createAssetTransfers(
  count: number,
  assets: readonly Asset[],
  startKey: string,
  spanDays: number,
): AssetTransfer[] {
  return Array.from({ length: count }, (_, index) => {
    const category = TRANSFER_CATEGORIES[index % TRANSFER_CATEGORIES.length];
    const cycleIndex = Math.floor(index / TRANSFER_CATEGORIES.length);
    const asset = assets[cycleIndex % assets.length];
    const occurredAt = distributedTimestamp(
      index,
      count,
      startKey,
      spanDays,
      30,
    );
    const common = {
      id: benchmarkId("transfer", index),
      occurredAt,
      timePrecision: "second" as const,
      assetSymbol: asset.symbol,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    switch (category) {
      case "external-in":
        return {
          ...common,
          quantity: "20",
          category,
          reason: "deposit",
          unitPrice: "25",
          toLocation: "exchange",
        };
      case "gain":
        return {
          ...common,
          quantity: "5",
          category,
          reason: "airdrop",
          unitPrice: "25",
          toLocation: "exchange",
        };
      case "internal":
        return {
          ...common,
          quantity: "4",
          category,
          reason: "internal-move",
          networkFee: "0.1",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        };
      case "external-out":
        return {
          ...common,
          quantity: "1",
          category,
          reason: "withdrawal",
          networkFee: "0.1",
          fromLocation: "cold-wallet",
        };
    }
  });
}

function createPriceSnapshots(
  count: number,
  assets: readonly Asset[],
  startKey: string,
  spanDays: number,
  rng: ReturnType<typeof createDeterministicRng>,
): PriceSnapshot[] {
  return Array.from({ length: count }, (_, index) => {
    const assetIndex = index % assets.length;
    const occurredAt = distributedTimestamp(index, count, startKey, spanDays, 40);
    return {
      id: benchmarkId("price", index),
      assetSymbol: assets[assetIndex].symbol,
      price: String(25 + assetIndex * 7 + rng.integer(0, 20)),
      currency: "USDT",
      recordedAt: occurredAt,
      source: "manual",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  });
}

function selectAssetCount(tradeCount: number): number {
  if (tradeCount < 1_000) return 10;
  if (tradeCount < 10_000) return 12;
  if (tradeCount < 100_000) return 16;
  return 20;
}

function distributedTimestamp(
  index: number,
  count: number,
  startKey: string,
  spanDays: number,
  secondOffset: number,
): string {
  const dayOffset = Math.min(
    spanDays - 1,
    Math.floor((index * spanDays) / Math.max(1, count)),
  );
  const seconds = secondOffset + (index % 3_000);
  const date = new Date(`${addUtcDays(startKey, dayOffset)}T00:00:00.000Z`);
  date.setUTCSeconds(seconds);
  return date.toISOString();
}

function addUtcDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function benchmarkId(kind: string, index: number): string {
  return `benchmark-${kind}-${String(index + 1).padStart(9, "0")}`;
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Synthetic todayKey must be an ISO date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Synthetic todayKey must be a real calendar date");
  }
}
