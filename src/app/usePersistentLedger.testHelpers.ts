import { cleanup } from "@testing-library/react";
import {
  afterEach,
  vi,
} from "vitest";
import type {
  LedgerData,
  Trade,
} from "@/core/models";
import type { StorageAdapter } from "@/platform/legacy";
import type { StoredLedgerEnvelopeV2 } from "@/platform/legacy";
import { createNoopStoredLedgerEnvelope } from "@/test-support";
import { type LedgerRepository } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  createUsdtAsset as createAsset,
  createUsdtPriceSnapshot as createPriceSnapshot,
  createUsdtSimpleTrade as createSimpleTrade,
  sampleUsdtTrades as sampleTrades,
} from "@/test-support";
import type { LedgerClock } from "@/core/shared";
import { usePersistentLedger as usePersistentLedgerRuntime } from "./usePersistentLedger";

export const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

export function usePersistentLedger(repository: LedgerRepository) {
  return usePersistentLedgerRuntime(repository, fixedClock);
}

afterEach(() => {
  cleanup();
});

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    value: "unchanged",
    writable: true,
  });
  window.dispatchEvent(event);
  return event;
}

export function createRepository(overrides: Partial<LedgerRepository> = {}) {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    ...overrides,
  } satisfies LedgerRepository;
}

export function createMemoryStorageAdapter(
  initialLedger: LedgerData | null,
  write: (envelope: StoredLedgerEnvelopeV2) => Promise<void> = async () => undefined,
) {
  let stored: StoredLedgerEnvelopeV2 | null = initialLedger
    ? createNoopStoredLedgerEnvelope(JSON.stringify(initialLedger))
    : null;

  const adapter: StorageAdapter = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (envelope) => {
      await write(envelope);
      stored = envelope;
    }),
    clear: vi.fn(async () => {
      stored = null;
    }),
  };

  return { adapter, readStored: () => stored };
}

export function addTrade(
  applyLedgerAction: ReturnType<
    typeof usePersistentLedger
  >["applyLedgerAction"],
  trade: Trade,
) {
  return applyLedgerAction({ type: "trade/add", trade });
}

export function createCompleteLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();

  return {
    ...initialLedger,
    assets: [...initialLedger.assets, createAsset("SOL", "Solana")],
    trades: [createSimpleTrade("trade-clear", "buy", "BTC", "1")],
    priceSnapshots: [
      createPriceSnapshot(
        "price-clear",
        "BTC",
        "80000",
        "2026-07-16",
      ),
    ],
    feeRules: [
      {
        id: "fee-clear",
        name: "Clear test fee",
        platform: "Test",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
  };
}

export function createCompleteBackupLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();
  const feeRule = {
    id: "fee-backup",
    name: "Backup test fee",
    platform: "Test",
    assetSymbol: "BTC",
    status: "active" as const,
    type: "percentage" as const,
    rate: "0.001",
    currency: "USDT" as const,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };

  return {
    ...initialLedger,
    assets: [...initialLedger.assets, createAsset("SOL", "Solana")],
    trades: structuredClone(sampleTrades).map((trade, index) => ({
      ...trade,
      note: index === 0 ? "golden backup note" : trade.note,
      rawText: trade.rawText ?? `golden backup ${index}`,
      platform: index === 0 ? feeRule.platform : trade.platform,
      feeRuleId: index === 0 ? feeRule.id : undefined,
    })),
    priceSnapshots: [
      createPriceSnapshot("price-backup-btc", "BTC", "80000", "2026-07-16"),
      createPriceSnapshot("price-backup-eth", "ETH", "2200", "2026-07-16"),
      {
        ...createPriceSnapshot(
          "price-backup-binance",
          "ADA",
          "0.75",
          "2026-07-17",
        ),
        source: "api",
        binanceProvenance: {
          provider: "binance",
          symbol: "ADAUSDT",
          sourceQuoteCurrency: "USDT",
          fetchedAt: "2026-07-17T08:00:00Z",
        },
      },
    ],
    feeRules: [feeRule],
  };
}
