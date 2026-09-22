// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
} from "@/platform/persistence";
import { DashboardShell } from "./DashboardShell";
import { createMemoryRepository } from "./DashboardShell.testHelpers";

vi.mock("echarts/core", () => ({
  init: vi.fn(() => ({
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  })),
  use: vi.fn(),
}));

/**
 * B0-1（W18 01A）：记账页的新表单只要填了时刻就报「地点无效」，因为产品造草稿时
 * 地点是空字符串，下拉框却显示着「设备时区」。这里的每条用例都走产品真实路径：
 * DashboardShell 带 session 打开记账页，草稿由它自己造，用例从不手选地点。
 *
 * Budapest is UTC+2 on 2026-08-20, so 09:30 there is stored as +02:00.
 */
const clock: LedgerClock = {
  now: () => new Date("2026-12-01T12:00:00Z"),
  timeZone: () => "Europe/Budapest",
};

const FACT_DATE = "2026-08-20";

function ledgerWithCash(): LedgerData {
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

async function openRecordPage() {
  const repository = createMemoryRepository(ledgerWithCash());
  const session = createLedgerSession({
    storageKind: "ledger-file",
    repository,
    capabilities: LEDGER_FILE_CAPABILITIES,
    createSessionId: () => "record-form-initial-place",
  });
  render(<DashboardShell clock={clock} session={session} />);
  await waitFor(() => {
    expect(
      screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
    ).toBeNull();
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "记账" }));
  return { repository, user };
}

function formWithButton(name: string): HTMLElement {
  const form = screen.getByRole("button", { name }).closest("form");
  if (!form) throw new Error(`No form holds the button: ${name}`);
  return form;
}

async function savedLedger(
  repository: ReturnType<typeof createMemoryRepository>,
  saved: (ledgerData: LedgerData) => boolean,
): Promise<LedgerData> {
  let ledgerData: LedgerData | null = null;
  await waitFor(async () => {
    ledgerData = await repository.load();
    expect(ledgerData !== null && saved(ledgerData)).toBe(true);
  });
  return ledgerData!;
}

async function recordTrade(time: string) {
  const { repository, user } = await openRecordPage();
  await user.selectOptions(
    screen.getByLabelText("记账对象", { selector: "select" }),
    "trade:BTC",
  );
  const form = formWithButton("保存交易");
  await user.type(within(form).getByLabelText("数量"), "1");
  await user.type(within(form).getByLabelText("成交均价"), "100");
  await user.clear(within(form).getByLabelText("日期"));
  await user.type(within(form).getByLabelText("日期"), FACT_DATE);
  if (time !== "") await user.type(within(form).getByLabelText("时刻"), time);
  await user.click(within(form).getByRole("button", { name: "保存交易" }));
  const ledgerData = await savedLedger(
    repository,
    (ledger) => ledger.trades.length === 1,
  );
  return ledgerData.trades[0];
}

async function recordPrice(time: string) {
  const { repository, user } = await openRecordPage();
  const form = formWithButton("保存价格");
  await user.type(within(form).getByLabelText("当前价格"), "100");
  await user.clear(within(form).getByLabelText("价格日期"));
  await user.type(within(form).getByLabelText("价格日期"), FACT_DATE);
  if (time !== "") await user.type(within(form).getByLabelText("时刻"), time);
  await user.click(within(form).getByRole("button", { name: "保存价格" }));
  const ledgerData = await savedLedger(
    repository,
    (ledger) => ledger.priceSnapshots.length === 1,
  );
  return ledgerData.priceSnapshots[0];
}

async function recordCashEvent(time: string) {
  const { repository, user } = await openRecordPage();
  const form = formWithButton("保存现金事实");
  await user.type(within(form).getByLabelText("金额"), "50");
  await user.clear(within(form).getByLabelText("日期"));
  await user.type(within(form).getByLabelText("日期"), FACT_DATE);
  if (time !== "") await user.type(within(form).getByLabelText("时刻"), time);
  await user.click(within(form).getByRole("button", { name: "保存现金事实" }));
  const ledgerData = await savedLedger(
    repository,
    (ledger) => ledger.cashEvents.length === 2,
  );
  return ledgerData.cashEvents.find((event) => event.id !== "seed-deposit");
}

async function recordAssetTransfer(time: string) {
  const { repository, user } = await openRecordPage();
  await user.selectOptions(
    screen.getByLabelText("记账对象", { selector: "select" }),
    "asset-transfer",
  );
  const form = formWithButton("保存资产转入转出");
  await user.selectOptions(within(form).getByLabelText("转移类别"), "external-in");
  await user.type(within(form).getByLabelText("数量"), "2");
  await user.type(within(form).getByLabelText("到账单价（USDT）"), "4");
  await user.clear(within(form).getByLabelText("日期"));
  await user.type(within(form).getByLabelText("日期"), FACT_DATE);
  if (time !== "") await user.type(within(form).getByLabelText("时刻"), time);
  await user.click(
    within(form).getByRole("button", { name: "保存资产转入转出" }),
  );
  const ledgerData = await savedLedger(
    repository,
    (ledger) => ledger.assetTransfers.length === 1,
  );
  return ledgerData.assetTransfers[0];
}

describe("a new record form saves a filled time without the place being touched", () => {
  it("cash event", async () => {
    const cashEvent = await recordCashEvent("09:30");
    expect(cashEvent?.occurredAt).toBe(`${FACT_DATE}T09:30:00+02:00`);
    expect(cashEvent?.occurredTimeZone).toBe("Europe/Budapest");
    expect(cashEvent?.timePrecision).toBe("minute");
  });

  it("asset transfer", async () => {
    const transfer = await recordAssetTransfer("09:30");
    expect(transfer?.occurredAt).toBe(`${FACT_DATE}T09:30:00+02:00`);
    expect(transfer?.occurredTimeZone).toBe("Europe/Budapest");
    expect(transfer?.timePrecision).toBe("minute");
  });
});

describe("a new record form with the time left empty still records the plain date", () => {
  // D-3：只记到天的路径在修 B0-1 前后必须完全一样——没有地点字段，精度是天。
  it("trade", async () => {
    const trade = await recordTrade("");
    expect(trade?.occurredAt).toBe(FACT_DATE);
    expect(trade?.timePrecision).toBe("day");
    expect(trade).not.toHaveProperty("occurredTimeZone");
  });

  it("price", async () => {
    const price = await recordPrice("");
    expect(price?.recordedAt).toBe(FACT_DATE);
    expect(price).not.toHaveProperty("occurredTimeZone");
  });
});
