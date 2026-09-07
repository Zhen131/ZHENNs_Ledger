// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssetTransfer,
  CashEvent,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { AssetTransferPanel } from "@/features/asset-transfers/ui";
import { CashEventPanel } from "@/features/cash/ui";
import { PriceForm } from "@/features/prices/ui";
import { TradeForm } from "@/features/trades/ui";

afterEach(cleanup);

/**
 * Budapest moves its clocks at 01:00 UTC on the last Sunday of March and of
 * October. Derived from the runtime IANA database, not from any table:
 *   2026-03-29 01:00Z turns local 01:59 into 03:00, so local 02:30 never
 *   happens that day.
 *   2026-10-25 01:00Z turns local 02:59 back into 02:00, so local 02:30
 *   happens twice that day.
 */
const SPRING_GAP_DAY = "2026-03-29";
const AUTUMN_OVERLAP_DAY = "2026-10-25";
const TRANSITION_WALL_TIME = "02:30";

const clock: LedgerClock = {
  now: () => new Date("2026-12-01T12:00:00Z"),
  timeZone: () => "Europe/Budapest",
};

function ledgerWithCash() {
  const ledgerData = createInitialLedgerData();
  ledgerData.cashEvents = [
    {
      id: "seed-deposit",
      type: "deposit",
      amount: "100000",
      currency: "USDT",
      occurredAt: "2026-01-01",
      timePrecision: "day",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  return ledgerData;
}

function ledgerWithHoldings() {
  const ledgerData = ledgerWithCash();
  ledgerData.assetTransfers = [
    {
      id: "seed-transfer",
      occurredAt: "2026-01-02",
      timePrecision: "day",
      assetSymbol: ledgerData.assets[0].symbol,
      quantity: "10",
      category: "external-in",
      reason: "deposit",
      unitPrice: "100",
      toLocation: "exchange",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
  return ledgerData;
}

const panelProps = {
  clock,
  ledgerEpoch: 0,
  mutationVersion: 0,
  persistedVersion: 0,
  persistenceStatus: "saved" as const,
  isWritable: true,
};

function stubRandomId(value: string) {
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => value,
  });
}

// ---------------------------------------------------------------------------
// Each renderer fills the smallest valid entry, optionally sets a time and a
// place, submits, and returns whatever record the form handed to the ledger.
// ---------------------------------------------------------------------------

async function recordTrade(
  time?: string,
  date = "2026-08-20",
): Promise<Trade | undefined> {
  stubRandomId("trade-under-test");
  const onTradeCreated = vi.fn<(fact: Trade) => "applied">(() => "applied");
  const ledgerData = ledgerWithCash();
  render(
    <TradeForm
      clock={clock}
      ledgerData={ledgerData}
      ledgerEpoch={0}
      mutationVersion={0}
      onTradeCreated={onTradeCreated}
      persistedVersion={0}
      persistenceStatus="saved"
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("数量"), "1");
  await user.type(screen.getByLabelText("成交均价"), "100");
  await user.clear(screen.getByLabelText("日期"));
  await user.type(screen.getByLabelText("日期"), date);
  if (time !== undefined) {
    await user.type(screen.getByLabelText("时刻"), time);
    await user.selectOptions(screen.getByLabelText("地点"), "Europe/Budapest");
  }
  await user.click(screen.getByRole("button", { name: "保存交易" }));
  return onTradeCreated.mock.calls[0]?.[0];
}

async function recordPrice(
  time?: string,
  date = "2026-08-20",
): Promise<PriceSnapshot | undefined> {
  stubRandomId("price-under-test");
  const onPriceSnapshotCreated = vi.fn<(fact: PriceSnapshot) => "applied">(() => "applied");
  render(
    <PriceForm
      clock={clock}
      ledgerData={createInitialLedgerData()}
      onPriceSnapshotCreated={onPriceSnapshotCreated}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("当前价格"), "100");
  await user.clear(screen.getByLabelText("价格日期"));
  await user.type(screen.getByLabelText("价格日期"), date);
  if (time !== undefined) {
    await user.type(screen.getByLabelText("时刻"), time);
    await user.selectOptions(screen.getByLabelText("地点"), "Europe/Budapest");
  }
  await user.click(screen.getByRole("button", { name: "保存价格" }));
  return onPriceSnapshotCreated.mock.calls[0]?.[0];
}

async function recordCashEvent(
  time?: string,
  date = "2026-08-20",
): Promise<CashEvent | undefined> {
  stubRandomId("cash-under-test");
  const onCashEventCreated = vi.fn<(fact: CashEvent) => "applied">(() => "applied");
  render(
    <CashEventPanel
      {...panelProps}
      ledgerData={ledgerWithCash()}
      onCashEventCreated={onCashEventCreated}
      onCashEventDeleted={vi.fn(() => "applied" as const)}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("金额"), "50");
  await user.clear(screen.getByLabelText("日期"));
  await user.type(screen.getByLabelText("日期"), date);
  if (time !== undefined) {
    await user.type(screen.getByLabelText("时刻"), time);
    await user.selectOptions(screen.getByLabelText("地点"), "Europe/Budapest");
  }
  await user.click(screen.getByRole("button", { name: "保存现金事实" }));
  return onCashEventCreated.mock.calls[0]?.[0];
}

async function recordAssetTransfer(
  time?: string,
  date = "2026-08-20",
): Promise<AssetTransfer | undefined> {
  stubRandomId("transfer-under-test");
  const onAssetTransferCreated = vi.fn<(fact: AssetTransfer) => "applied">(() => "applied");
  render(
    <AssetTransferPanel
      {...panelProps}
      ledgerData={ledgerWithHoldings()}
      onAssetTransferCreated={onAssetTransferCreated}
      onAssetTransferDeleted={vi.fn(() => "applied" as const)}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("转移类别"), "external-in");
  await user.type(screen.getByLabelText("数量"), "2");
  await user.type(screen.getByLabelText("到账单价（USDT）"), "4");
  await user.clear(screen.getByLabelText("日期"));
  await user.type(screen.getByLabelText("日期"), date);
  if (time !== undefined) {
    await user.type(screen.getByLabelText("时刻"), time);
    await user.selectOptions(screen.getByLabelText("地点"), "Europe/Budapest");
  }
  await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));
  return onAssetTransferCreated.mock.calls[0]?.[0];
}

// ---------------------------------------------------------------------------

describe("leaving the time empty keeps a fact on the plain date", () => {
  // These four strings are what the same four forms produced at
  // main@0b5e475, before this batch existed. They are the compatibility
  // line: an entry with the time left empty must still serialise to exactly
  // this, byte for byte, with no place and day precision.
  it("trade", async () => {
    expect(JSON.stringify(await recordTrade())).toBe(
      '{"occurredAt":"2026-08-20","timePrecision":"day","type":"buy","assetSymbol":"BTC","quantity":"1","price":"100","totalValue":"100","currency":"USDT","fee":"0","feeCurrency":"USDT","id":"trade-under-test","rawText":"Structured ledger entry: {\\"occurredAt\\":\\"2026-08-20\\",\\"timePrecision\\":\\"day\\",\\"type\\":\\"buy\\",\\"assetSymbol\\":\\"BTC\\",\\"quantity\\":\\"1\\",\\"price\\":\\"100\\",\\"totalValue\\":\\"100\\",\\"currency\\":\\"USDT\\",\\"fee\\":\\"0\\",\\"feeCurrency\\":\\"USDT\\"}","createdAt":"2026-12-01T12:00:00.000Z","updatedAt":"2026-12-01T12:00:00.000Z"}',
    );
  });

  it("price", async () => {
    expect(JSON.stringify(await recordPrice())).toBe(
      '{"assetSymbol":"BTC","price":"100","currency":"USDT","recordedAt":"2026-08-20","source":"manual","id":"price-under-test","createdAt":"2026-12-01T12:00:00.000Z","updatedAt":"2026-12-01T12:00:00.000Z"}',
    );
  });

  it("cash event", async () => {
    expect(JSON.stringify(await recordCashEvent())).toBe(
      '{"id":"cash-under-test","occurredAt":"2026-08-20","timePrecision":"day","currency":"USDT","createdAt":"2026-12-01T12:00:00.000Z","updatedAt":"2026-12-01T12:00:00.000Z","type":"deposit","amount":"50"}',
    );
  });

  it("asset transfer", async () => {
    expect(JSON.stringify(await recordAssetTransfer())).toBe(
      '{"id":"transfer-under-test","occurredAt":"2026-08-20","timePrecision":"day","assetSymbol":"BTC","quantity":"2","category":"external-in","reason":"deposit","createdAt":"2026-12-01T12:00:00.000Z","updatedAt":"2026-12-01T12:00:00.000Z","toLocation":"cold-wallet","unitPrice":"4"}',
    );
  });
});

describe("filling the time records the moment and the place", () => {
  // Budapest is UTC+2 on 2026-08-20, so 09:30 there is 07:30 in Greenwich and
  // the stored offset has to read +02:00. Seconds are pinned to 00.
  it("trade", async () => {
    const trade = await recordTrade("09:30");
    expect(trade?.occurredAt).toBe("2026-08-20T09:30:00+02:00");
    expect(trade?.occurredTimeZone).toBe("Europe/Budapest");
    expect(trade?.timePrecision).toBe("minute");
  });

  it("price", async () => {
    const price = await recordPrice("09:30");
    expect(price?.recordedAt).toBe("2026-08-20T09:30:00+02:00");
    expect(price?.occurredTimeZone).toBe("Europe/Budapest");
  });

  it("cash event", async () => {
    const cashEvent = await recordCashEvent("09:30");
    expect(cashEvent?.occurredAt).toBe("2026-08-20T09:30:00+02:00");
    expect(cashEvent?.occurredTimeZone).toBe("Europe/Budapest");
    expect(cashEvent?.timePrecision).toBe("minute");
  });

  it("asset transfer", async () => {
    const transfer = await recordAssetTransfer("09:30");
    expect(transfer?.occurredAt).toBe("2026-08-20T09:30:00+02:00");
    expect(transfer?.occurredTimeZone).toBe("Europe/Budapest");
    expect(transfer?.timePrecision).toBe("minute");
  });
});

describe("a moment that never happened is refused, and nothing is recorded", () => {
  const message =
    "这个时刻不存在：当地当天钟往前跳。请把时间留空，这一笔只记到天；或改填别的时刻、改用 UTC。";

  it("trade", async () => {
    expect(
      await recordTrade(TRANSITION_WALL_TIME, SPRING_GAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("price", async () => {
    expect(
      await recordPrice(TRANSITION_WALL_TIME, SPRING_GAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("cash event", async () => {
    expect(
      await recordCashEvent(TRANSITION_WALL_TIME, SPRING_GAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("asset transfer", async () => {
    expect(
      await recordAssetTransfer(TRANSITION_WALL_TIME, SPRING_GAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });
});

describe("a moment that happened twice is refused, and nothing is recorded", () => {
  const message =
    "这个时刻当天出现两次：当地当天钟往回退。请把时间留空，这一笔只记到天；或改填别的时刻、改用 UTC。";

  it("trade", async () => {
    expect(
      await recordTrade(TRANSITION_WALL_TIME, AUTUMN_OVERLAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("price", async () => {
    expect(
      await recordPrice(TRANSITION_WALL_TIME, AUTUMN_OVERLAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("cash event", async () => {
    expect(
      await recordCashEvent(TRANSITION_WALL_TIME, AUTUMN_OVERLAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("asset transfer", async () => {
    expect(
      await recordAssetTransfer(TRANSITION_WALL_TIME, AUTUMN_OVERLAP_DAY),
    ).toBeUndefined();
    expect(screen.getByText(message)).not.toBeNull();
  });
});
