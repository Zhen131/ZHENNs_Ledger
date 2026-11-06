import {
  afterEach,
  expect,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
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
import type { LedgerData } from "@/core/models";
import {
  createLedgerSession,
  INDEXED_DB_LEDGER_CAPABILITIES,
  type LedgerReadyClearDriver,
  type LedgerRepository,
  type LedgerSession,
  type LedgerSessionCapabilities,
  type LedgerStorageKind,
  type SessionQuiesceReason,
} from "@/platform/persistence";
import type { PersistentLedgerState } from "@/app/persistence";
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

export function createSimpleTrade(
  ...args: Parameters<typeof createUsdTradeFixture>
): ReturnType<typeof createUsdTradeFixture> {
  return {
    ...createUsdTradeFixture(...args),
    currency: "USDT",
    feeCurrency: "USDT",
  };
}

export function createPriceSnapshot(
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

export function DashboardShell({
  session,
  onFinalLock,
}: {
  session: LedgerSession;
  onFinalLock?: (
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    reason: SessionQuiesceReason,
  ) => Promise<void>;
}) {
  return (
    <DashboardShellRuntime
      clock={fixedClock}
      onFinalLock={onFinalLock}
      session={session}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export function createCompleteLedger(): LedgerData {
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

export function createFutureCorrectionLedger(): LedgerData {
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
  ledgerData.assetTransfers = [
    {
      id: "future-transfer-btc-a",
      occurredAt: "2026-07-26",
      timePrecision: "day",
      assetSymbol: "BTC",
      quantity: "3",
      category: "external-in",
      reason: "deposit",
      unitPrice: "20",
      toLocation: "cold-wallet",
      createdAt: "2026-07-26T08:00:00.000Z",
      updatedAt: "2026-07-26T08:00:00.000Z",
    },
    {
      id: "future-transfer-btc-b",
      occurredAt: "2026-07-26",
      timePrecision: "day",
      assetSymbol: "BTC",
      quantity: "4",
      category: "gain",
      reason: "airdrop",
      unitPrice: "5",
      toLocation: "cold-wallet-earn",
      createdAt: "2026-07-26T09:00:00.000Z",
      updatedAt: "2026-07-26T09:00:00.000Z",
    },
  ];
  return ledgerData;
}

export function createBackupFile(ledgerData: LedgerData): File {
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

export function createRawBackupFile(contents: string, name: string): File {
  const file = new File([contents], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => contents),
  });
  return file;
}

export function createMemoryRepository(
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

/**
 * Renders the shell the way the real entry does: always with a session.
 * The storage semantics default to what the shell itself defaults to when no
 * storage is named ("indexeddb" with its capabilities), so a migrated case
 * keeps the semantics it ran under before (08B section 3 item 2).
 */
export async function renderDashboard(
  repository: LedgerRepository = createMemoryRepository(),
  {
    storageKind = "indexeddb",
    capabilities = INDEXED_DB_LEDGER_CAPABILITIES,
    readyClearDriver,
  }: {
    storageKind?: LedgerStorageKind;
    capabilities?: LedgerSessionCapabilities;
    readyClearDriver?: LedgerReadyClearDriver;
  } = {},
) {
  const session = createLedgerSession({
    storageKind,
    repository,
    capabilities,
    readyClearDriver,
  });
  const view = render(<DashboardShell session={session} />);

  await waitFor(() => {
    expect(
      screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
    ).toBeNull();
  });

  return { ...view, session };
}

type DashboardPageName =
  | "首页"
  | "记账"
  | "交易"
  | "导入与导出"
  | "设置";

export async function goToPage(page: DashboardPageName) {
  await userEvent.setup().click(screen.getByRole("button", { name: page }));
  await screen.findByRole("heading", { level: 1, name: page });
}

/** Opens the trade form on the record page for the given asset. */
export async function goToTradeForm(assetSymbol = "BTC") {
  await goToPage("记账");
  await userEvent.setup().selectOptions(
    screen.getByLabelText("记账对象", { selector: "select" }),
    `trade:${assetSymbol}`,
  );
}

/** The complete holdings table behind the home page's view-all action. */
export async function openHoldingsDetails(): Promise<HTMLElement> {
  await goToPage("首页");
  await userEvent.setup().click(
    screen.getByRole("button", { name: "查看全部持仓" }),
  );
  return screen.getByRole("table", { name: "完整持仓与现金明细" });
}

export async function closeHoldingsDetails() {
  await userEvent.setup().click(
    screen.getByRole("button", { name: "关闭完整持仓详情" }),
  );
}

/** The unified activity table on the transactions page. */
export async function openActivityTable(): Promise<HTMLElement> {
  await goToPage("交易");
  return screen.getByRole("table");
}

/**
 * The transactions page deletes a trade only after a second activation and
 * a five-second review window; the window is run on fake timers so the case
 * does not wait in real time.
 */
export function deleteTradeAfterReview(buttonName: string) {
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // A removal that leaves cash negative asks once more, the same way a
    // trade that leaves cash negative does on the record page.
    const negativeCashDialog = screen.queryByRole("dialog", {
      name: "确认删除交易后的负现金",
    });
    if (negativeCashDialog) {
      fireEvent.click(
        within(negativeCashDialog).getByRole("button", {
          name: "确认并删除",
        }),
      );
    }
  } finally {
    vi.useRealTimers();
  }
}

export async function fillBuyTrade() {
  const user = userEvent.setup();

  if (screen.queryByRole("button", { name: "保存交易" }) === null) {
    await user.click(screen.getByRole("button", { name: "记账" }));
  }

  const recordTarget = screen.queryByLabelText("记账对象", {
    selector: "select",
  });
  if (recordTarget) {
    await user.selectOptions(recordTarget, "trade:BTC");
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

export async function confirmNegativeCashIfNeeded(
  user: ReturnType<typeof userEvent.setup>,
) {
  const dialog = screen.queryByRole("dialog", {
    name: "确认交易后的负现金",
  });
  if (dialog) {
    await user.click(
      within(dialog).getByRole("button", { name: "确认并保存" }),
    );
  }
}

export async function createTrade(input: {
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
  await confirmNegativeCashIfNeeded(user);
  return user;
}
