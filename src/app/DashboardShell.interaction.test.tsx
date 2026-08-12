// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "@/features/backup";
import { createTestLedgerRepository } from "@/test-support";
import type { LedgerData } from "@/core/models";
import type {
  LedgerRepository,
  LedgerReadyClearDriver,
  LedgerSession,
  LedgerSessionCapabilities,
  LedgerStorageKind,
  SessionQuiesceReason,
} from "@/platform/persistence";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  createLedgerSession,
  createReadyLedgerClearAuthorizationForDriver,
  LEDGER_FILE_CAPABILITIES,
} from "@/platform/persistence";
import type { PersistentLedgerState } from "./usePersistentLedger";
import { createInitialLedgerData } from "@/core/state";
import {
  createAsset as createUsdAssetFixture,
  createPriceSnapshot as createUsdPriceFixture,
  createSimpleTrade as createUsdTradeFixture,
} from "@/test-support";
import type { LedgerClock } from "@/core/shared";
import { DashboardShell as DashboardShellRuntime } from "./DashboardShell";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

function createAsset(
  ...args: Parameters<typeof createUsdAssetFixture>
): ReturnType<typeof createUsdAssetFixture> {
  return { ...createUsdAssetFixture(...args), quoteCurrency: "USDT" };
}

function createSimpleTrade(
  ...args: Parameters<typeof createUsdTradeFixture>
): ReturnType<typeof createUsdTradeFixture> {
  return {
    ...createUsdTradeFixture(...args),
    currency: "USDT",
    feeCurrency: "USDT",
  };
}

function createPriceSnapshot(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
) {
  return createUsdPriceFixture(
    id,
    assetSymbol,
    price,
    recordedAt,
    "USDT",
  );
}

function DashboardShell({
  repository,
  capabilities,
  storageKind,
  session,
  onFinalLock,
}: {
  repository?: LedgerRepository;
  capabilities?: LedgerSessionCapabilities;
  storageKind?: LedgerStorageKind;
  session?: LedgerSession;
  onFinalLock?: (
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    reason: SessionQuiesceReason,
  ) => Promise<void>;
}) {
  return (
    <DashboardShellRuntime
      capabilities={capabilities}
      clock={fixedClock}
      onFinalLock={onFinalLock}
      repository={repository}
      session={session}
      storageKind={storageKind}
    />
  );
}

vi.mock("echarts/core", () => ({
  init: vi.fn((container: HTMLElement) => {
    const handlers = new Map<string, (params: unknown) => void>();
    const dispatchClick = () =>
      handlers.get("click")?.({
        data: ["2026-07-14", 1, 1, 1, 0],
      });
    container.addEventListener("click", dispatchClick);

    return {
      dispose: vi.fn(() =>
        container.removeEventListener("click", dispatchClick),
      ),
      off: vi.fn((eventName: string) => handlers.delete(eventName)),
      on: vi.fn(
        (eventName: string, handler: (params: unknown) => void) =>
          handlers.set(eventName, handler),
      ),
      resize: vi.fn(),
      setOption: vi.fn(),
    };
  }),
  use: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createCompleteLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();

  return {
    ...initialLedger,
    assets: [...initialLedger.assets, createAsset("SOL", "Solana")],
    trades: [
      createSimpleTrade("trade-clear-ui", "buy", "BTC", "1", "2026-07-14"),
    ],
    priceSnapshots: [
      createPriceSnapshot(
        "price-clear-ui",
        "BTC",
        "80000",
        "2026-07-16",
      ),
    ],
    feeRules: [
      {
        id: "fee-clear-ui",
        name: "UI clear fee",
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

function createFutureCorrectionLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets = ledgerData.assets.map((asset) => ({
    ...asset,
    binanceMapping: null,
  }));
  ledgerData.trades = [
    createSimpleTrade("normal-btc", "buy", "BTC", "2", "2026-07-14"),
    createSimpleTrade("future-eth-a", "buy", "ETH", "1", "2026-07-26"),
    createSimpleTrade("future-eth-b", "buy", "ETH", "2", "2026-07-26"),
  ];
  ledgerData.priceSnapshots = [
    createPriceSnapshot(
      "future-price-btc-a",
      "BTC",
      "70000",
      "2026-07-26",
    ),
    createPriceSnapshot(
      "future-price-btc-b",
      "BTC",
      "71000",
      "2026-07-26",
    ),
  ];
  return ledgerData;
}

function createBackupFile(ledgerData: LedgerData): File {
  const envelope = createBackupEnvelope(ledgerData, {
    appVersion: "0.1.0",
    exportedAt: "2026-07-23T12:34:56Z",
  });
  if (!envelope.ok) {
    throw new Error("Backup test fixture must be valid");
  }
  const serialized = serializeBackupEnvelope(envelope.value);
  const file = new File([serialized], "ledger-backup.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return file;
}

function createRawBackupFile(contents: string, name: string): File {
  const file = new File([contents], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => contents),
  });
  return file;
}

function getSection(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title }).closest("section");

  if (!section) {
    throw new Error(`Section not found: ${title}`);
  }

  return section;
}

function createMemoryRepository(
  initialData: LedgerData | null = null,
): LedgerRepository {
  let storedData =
    initialData === null ? null : structuredClone(initialData);

  return {
    load: vi.fn(async () =>
      storedData === null ? null : structuredClone(storedData),
    ),
    save: vi.fn(async (ledgerData) => {
      storedData = structuredClone(ledgerData);
    }),
    clear: vi.fn(async () => {
      storedData = null;
    }),
  };
}

async function renderDashboard(
  repository: LedgerRepository = createMemoryRepository(),
) {
  const view = render(<DashboardShell repository={repository} />);

  await waitFor(() => {
    expect(
      screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
    ).toBeNull();
  });

  return view;
}

async function fillBuyTrade() {
  const user = userEvent.setup();

  if (screen.queryByRole("button", { name: "保存交易" }) === null) {
    await user.click(screen.getByRole("button", { name: "记账" }));
  }

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    "buy",
  );
  await user.selectOptions(
    screen.getByLabelText("资产", { selector: "select" }),
    "BTC",
  );
  await user.type(screen.getByLabelText("数量"), "0.001");
  await user.type(screen.getByLabelText("成交均价"), "70000");
  const totalValueInput = screen.getByLabelText("成交金额（不含手续费）");
  await user.clear(totalValueInput);
  await user.type(totalValueInput, "70");
  const dateInput = screen.getByLabelText("日期");
  await user.clear(dateInput);
  await user.type(dateInput, "2026-07-14");

  return user;
}

async function createTrade(input: {
  type: "buy" | "sell";
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
}) {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    input.type,
  );
  await user.type(screen.getByLabelText("数量"), input.quantity);
  await user.type(screen.getByLabelText("成交均价"), input.price);
  await user.type(
    screen.getByLabelText("成交金额（不含手续费）"),
    input.totalValue,
  );

  const occurredAtInput = screen.getByLabelText("日期");
  if ((occurredAtInput as HTMLInputElement).value !== input.occurredAt) {
    await user.clear(occurredAtInput);
    await user.type(occurredAtInput, input.occurredAt);
  }

  await user.click(screen.getByRole("button", { name: "保存交易" }));
  return user;
}

describe("DashboardShell persistent workspace navigation", () => {
  it("switches all five pages without rehydrating and preserves mounted form input", async () => {
    const repository = createMemoryRepository();
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-navigation",
    });
    const user = userEvent.setup();
    render(<DashboardShell session={session} />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "记账" }));
    await user.type(screen.getByLabelText("数量"), "0.25");
    await user.type(screen.getByLabelText("当前价格"), "75000");
    for (const page of ["交易", "导入与导出", "设置", "首页", "记账"]) {
      await user.click(screen.getByRole("button", { name: page }));
      expect(
        screen.getByRole("heading", { level: 1, name: page }),
      ).toBeTruthy();
    }

    expect(repository.load).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe(
      "0.25",
    );
    expect(
      (screen.getByLabelText("当前价格") as HTMLInputElement).value,
    ).toBe("75000");
  });
});

describe("DashboardShell immediate lock decision B", () => {
  it("does not begin locking on the first dirty click and uses the same final action only after explicit discard", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository();
    repository.save = vi.fn(() => saveDeferred.promise);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-dirty-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "保存交易" }),
    );
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    expect(
      screen.getByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeTruthy();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeNull();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "我确定不要了，继续锁定",
      }),
    );
    expect(onFinalLock).toHaveBeenCalledOnce();
    expect(onFinalLock.mock.calls[0]?.[1]).toBe("immediate-lock");
    expect(onFinalLock.mock.calls[0]?.[0]).toEqual(
      expect.any(Function),
    );
  });

  it("lets a dirty user retry saving without beginning the final lock", async () => {
    const repository = createMemoryRepository();
    repository.save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-retry-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "保存交易" }),
    );
    await screen.findByText(
      "本地保存失败，页面数据尚未保存；刷新后将恢复上次成功保存的版本",
    );

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    await user.click(
      screen.getByRole("button", { name: "重新保存" }),
    );

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("region", {
          name: "未保存修改锁定确认",
        }),
      ).toBeNull();
    });
    expect(onFinalLock).not.toHaveBeenCalled();
  });

  it("locks a clean file session directly without a discard confirmation", async () => {
    const repository = createMemoryRepository();
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-clean-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });

    await userEvent.setup().click(
      screen.getByRole("button", { name: "锁定账本" }),
    );

    expect(onFinalLock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeNull();
  });
});

describe("DashboardShell trade interactions", () => {
  it("separates an accepted trade from pending and completed local persistence", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository();
    repository.save = vi.fn(() => saveDeferred.promise);
    await renderDashboard(repository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByRole("button", { name: "正在保存…" }),
    ).toHaveProperty("disabled", true);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("正在保存到本地")).not.toBeNull();
    });
    expect(screen.queryByText("已保存到本地")).toBeNull();

    saveDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });
  });

  it("lets the user retry the latest failed local save", async () => {
    const repository = createMemoryRepository();
    repository.save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce();
    await renderDashboard(repository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "本地保存失败，页面数据尚未保存；刷新后将恢复上次成功保存的版本",
        ),
      ).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it("requires explicit confirmation before abandoning dirty state for a repository switch", async () => {
    const oldRepository = createMemoryRepository();
    oldRepository.save = vi.fn(async () => {
      throw new Error("write failed");
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-ui-repository-switch",
          "buy",
          "ETH",
          "2",
          "2026-07-15",
        ),
      ],
    };
    const newRepository = createMemoryRepository(newLedger);
    const view = await renderDashboard(oldRepository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试保存" })).not.toBeNull();
    });

    view.rerender(<DashboardShell repository={newRepository} />);
    expect(
      screen.getByText(
        "当前账本尚未保存，已阻止切换本地账本存储。请先重试保存，或明确放弃未保存更改。",
      ),
    ).not.toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(newRepository.load).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "放弃未保存更改并切换",
      }),
    );
    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(within(getSection("交易列表")).getByText("ETH")).not.toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "放弃未保存更改并切换",
        }),
      ).toBeNull();
    });
  });

  it("creates a validated buy and updates both the trade list and positions", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));

    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("买入")).not.toBeNull();
    expect(within(tradeSection).getAllByText("70 USDT")).not.toHaveLength(0);

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByText("70000 USDT")).not.toBeNull();
  });

  it("creates, versions, and deactivates fee rules only after authenticated persistence", async () => {
    const repository = createMemoryRepository();
    await renderDashboard(repository);
    const user = userEvent.setup();
    const section = getSection("手续费规则");

    await user.type(within(section).getByLabelText("规则名"), "OKX BTC fee");
    await user.type(
      within(section).getByLabelText("平台（精确匹配）"),
      "OKX",
    );
    await user.type(within(section).getByLabelText("金额（USDT）"), "5");
    await user.click(
      within(section).getByRole("button", { name: "新增手续费规则" }),
    );
    await waitFor(() => {
      expect(
        within(section).getByText("手续费规则已认证保存"),
      ).not.toBeNull();
    });

    await user.type(
      within(section).getByLabelText("OKX BTC fee 新版本金额"),
      "6",
    );
    await user.click(
      within(section).getByRole("button", {
        name: "创建新版本并停用旧版",
      }),
    );
    await waitFor(async () => {
      const stored = await repository.load();
      expect(stored?.feeRules).toHaveLength(2);
      expect(stored?.feeRules[0]).toMatchObject({
        status: "inactive",
        type: "fixed",
        amount: "5",
      });
      expect(stored?.feeRules[1]).toMatchObject({
        status: "active",
        type: "fixed",
        amount: "6",
        replacesFeeRuleId: stored?.feeRules[0].id,
      });
    });

    const activeRule = (await repository.load())!.feeRules[1];
    await user.click(
      within(section).getAllByRole("button", { name: "停用规则" })[0],
    );
    await waitFor(async () => {
      const stored = await repository.load();
      expect(
        stored?.feeRules.find(({ id }) => id === activeRule.id),
      ).toMatchObject({ status: "inactive" });
      expect(stored?.feeRules).toHaveLength(2);
    });
  });

  it("requires explicit fee candidate adoption and persists a user override as history", async () => {
    const ledger = createInitialLedgerData();
    ledger.feeRules = [
      {
        id: "fee-binance-btc",
        name: "Binance BTC percentage",
        platform: "Binance",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ];
    const repository = createMemoryRepository(ledger);
    await renderDashboard(repository);
    const user = userEvent.setup();
    const tradeSection = getSection("新增交易");

    await user.clear(within(tradeSection).getByLabelText("数量"));
    await user.type(within(tradeSection).getByLabelText("数量"), "1");
    await user.clear(within(tradeSection).getByLabelText("成交均价"));
    await user.type(within(tradeSection).getByLabelText("成交均价"), "6500");
    await user.clear(within(tradeSection).getByLabelText("成交金额（不含手续费）"));
    await user.type(
      within(tradeSection).getByLabelText("成交金额（不含手续费）"),
      "6500",
    );
    await user.clear(within(tradeSection).getByLabelText("日期"));
    await user.type(within(tradeSection).getByLabelText("日期"), "2026-07-14");
    await user.type(
      within(tradeSection).getByLabelText("平台（可选，精确匹配）"),
      "Binance",
    );

    expect(within(tradeSection).getByText(/候选：6.5 USDT/)).not.toBeNull();
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("0");
    await user.click(
      within(tradeSection).getByRole("button", { name: "采用此规则候选" }),
    );
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("6.5");
    await user.clear(within(tradeSection).getByLabelText("实际手续费"));
    await user.type(within(tradeSection).getByLabelText("实际手续费"), "7");
    expect(
      within(tradeSection).getByText(/实际手续费已由用户修改/),
    ).not.toBeNull();
    await user.click(
      within(tradeSection).getByRole("button", { name: "保存交易" }),
    );
    await waitFor(() => {
      expect(within(tradeSection).getByText("交易已认证保存")).not.toBeNull();
    });

    const stored = await repository.load();
    expect(stored?.trades[0]).toMatchObject({
      platform: "Binance",
      fee: "7",
      feeCurrency: "USDT",
      feeRuleId: "fee-binance-btc",
    });

    const ruleSection = getSection("手续费规则");
    await user.click(
      within(ruleSection).getByRole("button", { name: "停用规则" }),
    );
    await waitFor(async () => {
      const afterDeactivation = await repository.load();
      expect(afterDeactivation?.feeRules[0]).toMatchObject({
        status: "inactive",
      });
      expect(afterDeactivation?.trades[0]).toMatchObject({
        fee: "7",
        feeRuleId: "fee-binance-btc",
      });
    });
  });

  it("shows exact-match conflicts and never auto-selects the first active rule", async () => {
    const ledger = createInitialLedgerData();
    const common = {
      name: "OKX BTC fee",
      platform: "OKX",
      assetSymbol: "BTC",
      status: "active" as const,
      type: "fixed" as const,
      currency: "USDT" as const,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    };
    ledger.feeRules = [
      { ...common, id: "fee-okx-a", amount: "5" },
      { ...common, id: "fee-okx-b", amount: "7" },
    ];
    await renderDashboard(createMemoryRepository(ledger));
    const user = await fillBuyTrade();
    const tradeSection = getSection("新增交易");
    await user.type(
      within(tradeSection).getByLabelText("平台（可选，精确匹配）"),
      "OKX",
    );

    expect(
      within(tradeSection).getByText(/多条 active 规则冲突/),
    ).not.toBeNull();
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("0");
    expect(
      within(tradeSection).queryByRole("button", { name: "采用此规则候选" }),
    ).toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    await renderDashboard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "0.001");
    await user.type(screen.getByLabelText("成交均价"), "70000");
    await user.type(screen.getByLabelText("成交金额（不含手续费）"), "10");
    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByText("成交金额与数量 × 成交均价不一致"),
    ).not.toBeNull();
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
  });

  it("blocks deletion when removing a buy would invalidate a later sell", async () => {
    await renderDashboard();

    await createTrade({
      type: "buy",
      quantity: "10",
      price: "1",
      totalValue: "10",
      occurredAt: "2026-07-14",
    });
    const user = await createTrade({
      type: "sell",
      quantity: "5",
      price: "1",
      totalValue: "5",
      occurredAt: "2026-07-15",
    });

    const tradeSection = getSection("交易列表");
    const rowsBefore = within(tradeSection).getAllByRole("row");
    expect(rowsBefore).toHaveLength(3);

    const unsafeDelete = within(tradeSection).getByRole("button", {
      name: "删除 买入 BTC 2026-07-14",
    });
    await user.click(unsafeDelete);
    await user.click(unsafeDelete);

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(3);
    expect(within(getSection("资产汇总")).getByText("5")).not.toBeNull();
  });

  it("deletes a safe trade and updates both empty states", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    const tradeSection = getSection("交易列表");
    const safeDelete = within(tradeSection).getByRole("button", {
      name: "删除 买入 BTC 2026-07-14",
    });
    await user.click(safeDelete);
    await user.click(safeDelete);

    expect(
      within(tradeSection).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
  });

  it("saves a manual price and updates market value and unrealized PnL", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await screen.findByText("交易已认证保存");

    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expect(await screen.findByText("价格已认证保存")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("80000 USDT")).not.toBeNull();
    expect(within(positionSection).getByText("80 USDT")).not.toBeNull();
    expect(within(positionSection).getByText("10 USDT")).not.toBeNull();
  });

  it("hydrates saved LedgerData without overwriting it with initial state", async () => {
    const savedLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-hydrated",
          "buy",
          "ETH",
          "2",
          "2026-07-10",
        ),
      ],
    };
    const repository = createMemoryRepository(savedLedger);

    await renderDashboard(repository);

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("ETH")).not.toBeNull();
    expect(within(tradeSection).getByText("2")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("synchronizes both forms to assets restored from the saved ledger", async () => {
    const baseLedger = createInitialLedgerData();
    const savedLedger: LedgerData = {
      ...baseLedger,
      assets: [
        {
          ...baseLedger.assets[0],
          id: "asset-doge",
          symbol: "DOGE",
          name: "Dogecoin",
        },
      ],
    };

    await renderDashboard(createMemoryRepository(savedLedger));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("资产", {
          selector: "select",
        }) as HTMLSelectElement).value,
      ).toBe("DOGE");
      expect(
        (screen.getByLabelText("价格资产", {
          selector: "select",
        }) as HTMLSelectElement).value,
      ).toBe("DOGE");
    });
  });

  it("restores add, price, and delete across remounts, then keeps clear empty", async () => {
    const indexedDBFactory = new IDBFactory();
    const storageOptions = {
      indexedDBFactory,
      databaseName: "dashboard-persistence-round-trip",
    };
    const firstRepository =
      createTestLedgerRepository(storageOptions);
    const firstView = await renderDashboard(firstRepository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    await waitFor(async () => {
      const savedLedger = await firstRepository.load();
      expect(savedLedger?.trades).toHaveLength(1);
      expect(savedLedger?.priceSnapshots).toHaveLength(1);
    });

    firstView.unmount();

    const secondRepository =
      createTestLedgerRepository(storageOptions);
    const secondView = await renderDashboard(secondRepository);

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getAllByText("70 USDT")).not.toHaveLength(0);

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("80000 USDT")).not.toBeNull();
    expect(within(positionSection).getByText("80 USDT")).not.toBeNull();
    expect(within(positionSection).getByText("10 USDT")).not.toBeNull();

    const secondUser = userEvent.setup();
    const persistedDelete = within(tradeSection).getByRole("button", {
      name: "删除 买入 BTC 2026-07-14",
    });
    await secondUser.click(persistedDelete);
    await secondUser.click(persistedDelete);
    await waitFor(async () => {
      const savedLedger = await secondRepository.load();
      expect(savedLedger?.trades).toEqual([]);
      expect(savedLedger?.priceSnapshots).toHaveLength(1);
    });
    secondView.unmount();

    const thirdRepository =
      createTestLedgerRepository(storageOptions);
    const thirdView = await renderDashboard(thirdRepository);
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();

    const thirdUser = userEvent.setup();
    await thirdUser.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    await thirdUser.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await thirdUser.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );
    await waitFor(() => {
      expect(screen.getByText("账本已清空")).not.toBeNull();
    });
    await expect(thirdRepository.load()).resolves.toBeNull();
    thirdView.unmount();

    const fourthRepository =
      createTestLedgerRepository(storageOptions);
    await renderDashboard(fourthRepository);
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
    await expect(fourthRepository.load()).resolves.toBeNull();
  });

  it("filters the trade table from a heatmap day and toggles the same day off", async () => {
    const initialLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-filter-btc",
          "buy",
          "BTC",
          "1",
          "2026-07-14",
        ),
        createSimpleTrade(
          "trade-filter-eth",
          "buy",
          "ETH",
          "1",
          "2026-07-15",
        ),
      ],
    };
    await renderDashboard(createMemoryRepository(initialLedger));
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );

    const filteredSection = getSection("交易列表 · 2026-07-14");
    expect(within(filteredSection).getByText("BTC")).not.toBeNull();
    expect(within(filteredSection).queryByText("ETH")).toBeNull();

    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    const restoredSection = getSection("交易列表");
    expect(within(restoredSection).getByText("BTC")).not.toBeNull();
    expect(within(restoredSection).getByText("ETH")).not.toBeNull();
  });
});

describe("DashboardShell future fact correction", () => {
  it("deletes only the named future trade or price after two activations and persists across remount", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    const view = await renderDashboard(repository);
    const user = userEvent.setup();

    expect(screen.getByText("未来事实纠正模式")).not.toBeNull();
    expect(within(getSection("资产汇总")).queryByText("ETH")).toBeNull();
    const tradeDelete = screen.getByRole("button", {
      name: "删除未来交易 ETH 2026-07-26 future-eth-a",
    });
    const priceDelete = screen.getByRole("button", {
      name: "删除未来价格 BTC 2026-07-26 future-price-btc-a",
    });

    await user.click(tradeDelete);
    expect(repository.save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-a",
      }),
    ).not.toBeNull();
    await user.click(tradeDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", {
          name: "删除未来交易 ETH 2026-07-26 future-eth-a",
        }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-b",
      }),
    ).not.toBeNull();

    await user.click(priceDelete);
    expect(repository.save).toHaveBeenCalledTimes(1);
    await user.click(priceDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
    });
    const stored = await repository.load();
    expect(stored?.trades.map((trade) => trade.id)).toEqual([
      "normal-btc",
      "future-eth-b",
    ]);
    expect(stored?.priceSnapshots.map((snapshot) => snapshot.id)).toEqual([
      "future-price-btc-b",
    ]);

    view.unmount();
    await renderDashboard(repository);
    expect(
      screen.queryByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-a",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-b",
      }),
    ).not.toBeNull();
  });

  it("keeps delete-all two-stage and restores ordinary writes after the final future fact", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();
    const deleteAll = screen.getByRole("button", {
      name: "删除全部无效未来事实",
    });

    await user.click(deleteAll);
    expect(repository.save).not.toHaveBeenCalled();
    expect(screen.getByText("未来事实纠正模式")).not.toBeNull();
    await user.click(deleteAll);

    await waitFor(() => {
      expect(screen.queryByText("未来事实纠正模式")).toBeNull();
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(false);
    expect((await repository.load())?.trades.map((trade) => trade.id)).toEqual([
      "normal-btc",
    ]);
    expect((await repository.load())?.priceSnapshots).toEqual([]);
  });

  it("rejects deleting a future buy until its dependent future sell is removed", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = ledgerData.assets.map((asset) => ({
      ...asset,
      binanceMapping: null,
    }));
    ledgerData.trades = [
      createSimpleTrade("future-buy", "buy", "BTC", "1", "2026-07-26"),
      createSimpleTrade("future-sell", "sell", "BTC", "1", "2026-07-27"),
    ];
    const repository = createMemoryRepository(ledgerData);
    await renderDashboard(repository);
    const user = userEvent.setup();

    const buyDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-26 future-buy",
    });
    await user.click(buyDelete);
    await user.click(buyDelete);
    expect(
      screen.getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();

    const sellDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-27 future-sell",
    });
    await user.click(sellDelete);
    await user.click(sellDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
    });

    const remainingBuyDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-26 future-buy",
    });
    await user.click(remainingBuyDelete);
    await user.click(remainingBuyDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("未来事实纠正模式")).toBeNull();
    });
  });

  it("keeps the final single-delete dirty after save failure and confirms persistence only after retry", async () => {
    const initialLedger = createInitialLedgerData();
    initialLedger.assets = initialLedger.assets.map((asset) => ({
      ...asset,
      binanceMapping: null,
    }));
    initialLedger.priceSnapshots = [
      createPriceSnapshot(
        "future-final-price",
        "BTC",
        "70000",
        "2026-07-26",
      ),
    ];
    let storedLedger = structuredClone(initialLedger);
    let saveAttempts = 0;
    const repository: LedgerRepository = {
      load: vi.fn(async () => structuredClone(storedLedger)),
      save: vi.fn(async (ledgerData) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          throw new Error("first save fails");
        }
        storedLedger = structuredClone(ledgerData);
      }),
      clear: vi.fn(async () => undefined),
    };
    const view = await renderDashboard(repository);
    const user = userEvent.setup();
    const remove = screen.getByRole("button", {
      name: "删除未来价格 BTC 2026-07-26 future-final-price",
    });

    await user.click(remove);
    await user.click(remove);
    expect(screen.queryByText("未来事实纠正模式")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试保存" })).not.toBeNull();
    });
    expect(screen.queryByText("已保存到本地")).toBeNull();
    expect(storedLedger.priceSnapshots).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(storedLedger.priceSnapshots).toEqual([]);

    view.unmount();
    await renderDashboard(repository);
    expect(screen.queryByText("未来事实纠正模式")).toBeNull();
  });
});

describe("DashboardShell data management", () => {
  it("describes C as the only full ledger, opens pure B preflight and keeps B import fail-closed", async () => {
    const repository = createMemoryRepository();
    render(
      <DashboardShell
        capabilities={{
          canClearReadyLedger: false,
          canClearHydrationError: false,
          canImportBackup: false,
        }}
        repository={repository}
        storageKind="ledger-file"
      />,
    );
    const user = userEvent.setup();

    expect(
      await screen.findByText(
        /当前 .lftl 文件是唯一正式完整账本/,
      ),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "导出完整账本备份" }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("选择账本备份文件"),
    ).toBeTruthy();
    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(createInitialLedgerData()),
    );
    expect(
      await screen.findByText("B 历史导入预检报告"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "确认恢复备份" }),
    ).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "清空本地账本" }),
    ).toBeNull();
  });

  it("clears only the current C through fixed confirmation and accurate two-generation wording", async () => {
    const repository = createMemoryRepository(
      createCompleteLedger(),
    );
    const authorizeReadyClear = vi.fn((context) =>
      createReadyLedgerClearAuthorizationForDriver(context, {
        fileId: "dashboard-file",
        verifiedRevisionId: "dashboard-revision",
      }),
    );
    const readyClearDriver: LedgerReadyClearDriver = {
      authorizeReadyClear,
      clearReadyLedger: vi.fn(
        async (authorization, executionContext) => {
          if (
            !claimReadyLedgerClearExecutionContextForDriver(
              executionContext,
              authorization,
              readyClearDriver,
            )
          ) {
            throw new Error("invalid ready clear execution");
          }
        },
      ),
    };
    const { clearReadyLedger } = readyClearDriver;
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver,
      createSessionId: () => "dashboard-ready-clear",
    });
    render(<DashboardShell session={session} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "设置" }));
    await screen.findByText(/当前 .lftl 文件是唯一正式完整账本/);

    await user.click(
      await screen.findByRole("button", {
        name: "清空当前 C 账本",
      }),
    );
    expect(
      screen.getByText(
        /这只会清空当前 C 的账本内容，不删除 .lftl 文件，也不影响其他 C/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/上一可用版/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "确认清空当前 C 内容",
      }),
    );
    expect(
      screen.getByText(
        "请输入完整确认文本“清空当前C账本”",
      ),
    ).toBeTruthy();
    expect(authorizeReadyClear).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空当前C账本",
    );
    await user.click(
      screen.getByRole("button", {
        name: "确认清空当前 C 内容",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("当前 C 账本内容已清空"),
      ).toBeTruthy();
    });
    expect(authorizeReadyClear).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationNonce: "清空当前C账本",
        sessionId: "dashboard-ready-clear",
        generation: 0,
      }),
    );
    expect(clearReadyLedger).toHaveBeenCalledOnce();
    expect(repository.clear).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("选择账本备份文件"),
    ).toBeTruthy();
  });

  it("imports a confirmed backup through the UI and updates every dashboard view", async () => {
    const repository = createMemoryRepository();
    const candidate = createCompleteLedger();
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "手动价格" }));
    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    expect(getSection("交易列表 · 2026-07-14")).not.toBeNull();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(candidate),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(repository.save).not.toHaveBeenCalled();

    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledWith(candidate);
      expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
      expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
      expect(getSection("交易列表")).not.toBeNull();
      expect(screen.getByText(/已估值 1 项，总市值 80000 USDT/)).not.toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "手动价格" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("keeps the prior dashboard data when a confirmed import write fails", async () => {
    const priorLedger = createCompleteLedger();
    const repository = createMemoryRepository(priorLedger);
    repository.save = vi.fn(async () => {
      throw new Error("write failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(createInitialLedgerData()),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "导入失败；当前页面未变更。没有取得可进一步确认底层存储状态的证据，请按错误提示处理。",
        ),
      ).not.toBeNull();
    });
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).toHaveBeenCalledOnce();
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("rejects corrupt, future and non-USD/USDT backups without changing page or storage", async () => {
    const priorLedger = createCompleteLedger();
    const repository = createMemoryRepository(priorLedger);
    await renderDashboard(repository);
    const user = userEvent.setup();
    const futureLedger = createInitialLedgerData();
    futureLedger.trades = [
      createSimpleTrade(
        "future-import",
        "buy",
        "BTC",
        "1",
        "2099-01-01",
      ),
    ];
    const unsupportedLedger = createInitialLedgerData();
    unsupportedLedger.assets[0] = {
      ...unsupportedLedger.assets[0],
      quoteCurrency: "EUR",
    };

    const futureEnvelope = createBackupEnvelope(futureLedger, {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56Z",
    });
    const unsupportedEnvelope = createBackupEnvelope(unsupportedLedger, {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56Z",
    });
    expect(futureEnvelope.ok).toBe(true);
    expect(unsupportedEnvelope.ok).toBe(true);
    if (!futureEnvelope.ok || !unsupportedEnvelope.ok) return;

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createRawBackupFile("{", "corrupt.json"),
    );
    await waitFor(() => {
      expect(screen.getByText("预检发现硬错误；不得继续导入。")).not.toBeNull();
      expect(screen.getByText(/BACKUP_BAD_JSON/)).not.toBeNull();
    });

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createRawBackupFile(
        serializeBackupEnvelope(futureEnvelope.value),
        "future.json",
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(/LEDGER_IMPORT_FUTURE_FACT/)).not.toBeNull();
      expect(screen.getByText(/trades\[0\]\.occurredAt/)).not.toBeNull();
    });

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createRawBackupFile(
        serializeBackupEnvelope(unsupportedEnvelope.value),
        "unsupported.json",
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY/),
      ).not.toBeNull();
      expect(screen.getByText(/当前仅支持 USD\/USDT 估值/)).not.toBeNull();
    });

    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("recovers a hydration failure through backup import", async () => {
    const repository = createMemoryRepository();
    repository.load = vi.fn(async () => {
      throw new Error("read failed");
    });
    const candidate = createCompleteLedger();
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(candidate),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );

    await waitFor(() => {
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
      expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(false);
    expect(repository.save).toHaveBeenCalledWith(candidate);
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("keeps hydration recovery blocked when backup import cannot write", async () => {
    const repository = createMemoryRepository();
    repository.load = vi.fn(async () => {
      throw new Error("read failed");
    });
    repository.save = vi.fn(async () => {
      throw new Error("write failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(createCompleteLedger()),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "导入失败；当前页面未变更。没有取得可进一步确认底层存储状态的证据，请按错误提示处理。",
        ),
      ).not.toBeNull();
    });
    expect(
      screen.getByText(
        "本地账本读取失败，已停止自动保存以避免覆盖原数据",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("disables every write and backup path while an import is writing", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository(createCompleteLedger());
    repository.save = vi.fn(() => saveDeferred.promise);
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(createInitialLedgerData()),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(
        screen.getByText(
          /取消时会尝试恢复并复读导入前的完整 C；如果无法确认恢复，当前会话会停止后续写入并明确报错/,
        ),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "清空本地账本",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "导出完整账本备份",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("选择账本备份文件") as HTMLInputElement).disabled,
    ).toBe(true);

    saveDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });
  });

  it("does not clear when confirmation is cancelled or the fixed text is wrong", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    expect(
      screen.getByText(
        "这会永久删除自定义资产、交易、价格和手续费规则。请先导出完整账本备份。",
      ),
    ).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );
    expect(
      screen.getByText("请输入完整确认文本“清空本地账本”"),
    ).not.toBeNull();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("输入清空确认文本"), "错误文本");
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );
    expect(repository.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("输入清空确认文本")).toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("disables every write path while clear runs and shows success only afterward", async () => {
    const clearDeferred = createDeferred<void>();
    const repository = createMemoryRepository(createCompleteLedger());
    repository.clear = vi.fn(() => clearDeferred.promise);
    await renderDashboard(repository);
    const user = userEvent.setup();

    expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    expect(getSection("交易列表 · 2026-07-14")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
      expect(
        screen.getByText("正在清空本地账本，请勿关闭页面。"),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "确认永久清空",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    clearDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("账本已清空")).not.toBeNull();
    });

    expect(screen.queryAllByRole("option", { name: "SOL · Solana" })).toEqual([]);
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("offers controlled recovery after load failure and returns to writable state", async () => {
    const repository = createMemoryRepository();
    repository.load = vi.fn(async () => {
      throw new Error("read failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    expect(
      screen.getByText(
        "本地账本读取失败，已停止自动保存以避免覆盖原数据",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "清空本地账本" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "清除损坏或无法读取的本地数据",
      }),
    );
    expect(
      screen.getByText(
        "读取失败可能只是暂时性错误；继续将删除仍可能可恢复的自定义资产、交易、价格和手续费规则。请先使用有效备份恢复，或确认永久删除。",
      ),
    ).not.toBeNull();
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(screen.getByText("账本已清空")).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "清空本地账本" }),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(false);
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("keeps old UI data and shows only an error when clear fails", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    repository.clear = vi.fn(async () => {
      throw new Error("clear failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("清空本地账本失败，原页面与本地数据均未更改"),
      ).not.toBeNull();
    });
    expect(screen.queryByText("账本已清空")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "重试保存" }),
    ).toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("loads an oversized saved ledger as read-only without offering clear", async () => {
    const oversizedLedger = {
      ...createInitialLedgerData(),
      trades: [
        {
          ...createSimpleTrade(
            "trade-ui-resource-limit",
            "buy",
            "BTC",
            "1",
          ),
          note: "n".repeat(4_097),
        },
      ],
    };
    const repository = createMemoryRepository(oversizedLedger);
    await renderDashboard(repository);

    expect(
      screen.getByText(/当前账本超过资源上限，已只读加载/),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "清空本地账本",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });
});
