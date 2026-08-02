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
} from "../../backup/backupEnvelope";
import { createTestLedgerRepository } from "../../test/createTestLedgerRepository";
import type { LedgerData } from "../../models";
import type {
  LedgerRepository,
  LedgerReadyClearDriver,
  LedgerSession,
  LedgerSessionCapabilities,
  LedgerStorageKind,
  SessionQuiesceReason,
} from "../../repositories/ledgerRepository";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  createLedgerSession,
  createReadyLedgerClearAuthorizationForDriver,
  LEDGER_FILE_CAPABILITIES,
} from "../../repositories/ledgerRepository";
import type { PersistentLedgerState } from "../../hooks/usePersistentLedger";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import {
  createAsset,
  createPriceSnapshot,
  createSimpleTrade,
} from "../../test/fixtures";
import type { LedgerClock } from "../../utils/ledgerDate";
import { DashboardShell as DashboardShellRuntime } from "./DashboardShell";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

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

vi.mock("../charts/EChart", () => ({
  EChart: ({
    ariaLabel,
    events,
  }: {
    ariaLabel: string;
    events?: Record<string, (params: unknown) => void>;
  }) => (
    <button
      aria-label={ariaLabel}
      onClick={() =>
        events?.click?.({
          data: ["2026-07-14", 1, 1, 1, 0],
        })
      }
      type="button"
    />
  ),
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
        type: "percentage",
        rate: "0.001",
        currency: "USD",
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
      screen.queryByText("Loading the local ledger. No data will be written until loading completes."),
    ).toBeNull();
  });

  return view;
}

async function fillBuyTrade() {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("Type", { selector: "select" }),
    "buy",
  );
  await user.selectOptions(
    screen.getByLabelText("Asset", { selector: "select" }),
    "BTC",
  );
  await user.type(screen.getByLabelText("Quantity"), "0.001");
  await user.type(screen.getByLabelText("Average execution price"), "70000");
  await user.type(screen.getByLabelText("Total amount"), "70");
  await user.type(screen.getByLabelText("Date"), "2026-07-14");

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
    screen.getByLabelText("Type", { selector: "select" }),
    input.type,
  );
  await user.type(screen.getByLabelText("Quantity"), input.quantity);
  await user.type(screen.getByLabelText("Average execution price"), input.price);
  await user.type(screen.getByLabelText("Total amount"), input.totalValue);

  const occurredAtInput = screen.getByLabelText("Date");
  if ((occurredAtInput as HTMLInputElement).value !== input.occurredAt) {
    await user.clear(occurredAtInput);
    await user.type(occurredAtInput, input.occurredAt);
  }

  await user.click(screen.getByRole("button", { name: "Save trade" }));
  return user;
}

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
          "Loading the local ledger. No data will be written until loading completes.",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "Save trade" }),
    );
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    await user.click(
      screen.getByRole("button", { name: "Lock now" }),
    );
    expect(
      screen.getByRole("region", {
        name: "Confirm locking with unsaved changes",
      }),
    ).toBeTruthy();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("region", {
        name: "Confirm locking with unsaved changes",
      }),
    ).toBeNull();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Lock now" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Discard changes and continue locking",
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
          "Loading the local ledger. No data will be written until loading completes.",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "Save trade" }),
    );
    await screen.findByText(
      "Local save failed and the page data is unsaved. Refreshing will restore the last successfully saved version.",
    );

    await user.click(
      screen.getByRole("button", { name: "Lock now" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry this save" }),
    );

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("region", {
          name: "Confirm locking with unsaved changes",
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
          "Loading the local ledger. No data will be written until loading completes.",
        ),
      ).toBeNull();
    });

    await userEvent.setup().click(
      screen.getByRole("button", { name: "Lock now" }),
    );

    expect(onFinalLock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", {
        name: "Confirm locking with unsaved changes",
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

    await user.click(screen.getByRole("button", { name: "Save trade" }));

    expect(screen.getByText("Trade added to the ledger")).not.toBeNull();
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("Saving locally")).not.toBeNull();
    });
    expect(screen.queryByText("Saved locally")).toBeNull();

    saveDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("Saved locally")).not.toBeNull();
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

    await user.click(screen.getByRole("button", { name: "Save trade" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Local save failed and the page data is unsaved. Refreshing will restore the last successfully saved version.",
        ),
      ).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => {
      expect(screen.getByText("Saved locally")).not.toBeNull();
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

    await user.click(screen.getByRole("button", { name: "Save trade" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).not.toBeNull();
    });

    view.rerender(<DashboardShell repository={newRepository} />);
    expect(
      screen.getByText(
        "The current ledger is unsaved, so switching local storage was blocked. Retry saving or explicitly discard unsaved changes.",
      ),
    ).not.toBeNull();
    expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
    expect(newRepository.load).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "Discard unsaved changes and switch",
      }),
    );
    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(within(getSection("Trade List")).getByText("ETH")).not.toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Discard unsaved changes and switch",
        }),
      ).toBeNull();
    });
  });

  it("creates a validated buy and updates both the trade list and positions", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "Save trade" }));

    expect(screen.getByText("Trade added to the ledger")).not.toBeNull();

    const tradeSection = getSection("Trade List");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("Buy")).not.toBeNull();
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("Asset Summary");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByText("70000 USD")).not.toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    await renderDashboard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.type(screen.getByLabelText("Average execution price"), "70000");
    await user.type(screen.getByLabelText("Total amount"), "10");
    await user.type(screen.getByLabelText("Date"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "Save trade" }));

    expect(
      screen.getByText("Total amount does not match quantity × average execution price"),
    ).not.toBeNull();
    expect(
      within(getSection("Trade List")).getByText(
        "No trades yet. Added trades will appear here automatically.",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("Asset Summary")).getByText(
        "No positions yet. Added trades will be summarized here automatically.",
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

    const tradeSection = getSection("Trade List");
    const rowsBefore = within(tradeSection).getAllByRole("row");
    expect(rowsBefore).toHaveLength(3);

    const unsafeDelete = within(tradeSection).getByRole("button", {
      name: "Delete buy BTC 2026-07-14",
    });
    await user.click(unsafeDelete);
    await user.click(unsafeDelete);

    expect(
      within(tradeSection).getByText(
        "Cannot delete: this trade supports a later sell. Delete dependent later sells first.",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(3);
    expect(within(getSection("Asset Summary")).getByText("5")).not.toBeNull();
  });

  it("deletes a safe trade and updates both empty states", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "Save trade" }));

    const tradeSection = getSection("Trade List");
    const safeDelete = within(tradeSection).getByRole("button", {
      name: "Delete buy BTC 2026-07-14",
    });
    await user.click(safeDelete);
    await user.click(safeDelete);

    expect(
      within(tradeSection).getByText(
        "No trades yet. Added trades will appear here automatically.",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("Asset Summary")).getByText(
        "No positions yet. Added trades will be summarized here automatically.",
      ),
    ).not.toBeNull();
  });

  it("saves a manual price and updates market value and unrealized PnL", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "Save trade" }));

    await user.type(screen.getByLabelText("Current price"), "80000");
    await user.type(screen.getByLabelText("Price date"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "Save price" }));

    expect(screen.getByText("Price added to the ledger")).not.toBeNull();

    const positionSection = getSection("Asset Summary");
    expect(within(positionSection).getByText("80000 USD")).not.toBeNull();
    expect(within(positionSection).getByText("80 USD")).not.toBeNull();
    expect(within(positionSection).getByText("10 USD")).not.toBeNull();
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

    const tradeSection = getSection("Trade List");
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
        (screen.getByLabelText("Asset", {
          selector: "select",
        }) as HTMLSelectElement).value,
      ).toBe("DOGE");
      expect(
        (screen.getByLabelText("Price asset", {
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

    await user.click(screen.getByRole("button", { name: "Save trade" }));
    await user.type(screen.getByLabelText("Current price"), "80000");
    await user.type(screen.getByLabelText("Price date"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "Save price" }));

    await waitFor(async () => {
      const savedLedger = await firstRepository.load();
      expect(savedLedger?.trades).toHaveLength(1);
      expect(savedLedger?.priceSnapshots).toHaveLength(1);
    });

    firstView.unmount();

    const secondRepository =
      createTestLedgerRepository(storageOptions);
    const secondView = await renderDashboard(secondRepository);

    const tradeSection = getSection("Trade List");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("Asset Summary");
    expect(within(positionSection).getByText("80000 USD")).not.toBeNull();
    expect(within(positionSection).getByText("80 USD")).not.toBeNull();
    expect(within(positionSection).getByText("10 USD")).not.toBeNull();

    const secondUser = userEvent.setup();
    const persistedDelete = within(tradeSection).getByRole("button", {
      name: "Delete buy BTC 2026-07-14",
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
      within(getSection("Trade List")).getByText(
        "No trades yet. Added trades will appear here automatically.",
      ),
    ).not.toBeNull();

    const thirdUser = userEvent.setup();
    await thirdUser.click(
      screen.getByRole("button", { name: "Clear local ledger" }),
    );
    await thirdUser.type(
      screen.getByLabelText("Enter clear confirmation text"),
      "CLEAR LOCAL LEDGER",
    );
    await thirdUser.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );
    await waitFor(() => {
      expect(screen.getByText("The ledger was cleared.")).not.toBeNull();
    });
    await expect(thirdRepository.load()).resolves.toBeNull();
    thirdView.unmount();

    const fourthRepository =
      createTestLedgerRepository(storageOptions);
    await renderDashboard(fourthRepository);
    expect(
      within(getSection("Trade List")).getByText(
        "No trades yet. Added trades will appear here automatically.",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("Asset Summary")).getByText(
        "No positions yet. Added trades will be summarized here automatically.",
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
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    );

    const filteredSection = getSection("Trade List · 2026-07-14");
    expect(within(filteredSection).getByText("BTC")).not.toBeNull();
    expect(within(filteredSection).queryByText("ETH")).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    );
    const restoredSection = getSection("Trade List");
    expect(within(restoredSection).getByText("BTC")).not.toBeNull();
    expect(within(restoredSection).getByText("ETH")).not.toBeNull();
  });
});

describe("DashboardShell future fact correction", () => {
  it("deletes only the named future trade or price after two activations and persists across remount", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    const view = await renderDashboard(repository);
    const user = userEvent.setup();

    expect(screen.getByText("Future-fact correction mode")).not.toBeNull();
    expect(within(getSection("Asset Summary")).queryByText("ETH")).toBeNull();
    const tradeDelete = screen.getByRole("button", {
      name: "Delete future trade ETH 2026-07-26 future-eth-a",
    });
    const priceDelete = screen.getByRole("button", {
      name: "Delete future price BTC 2026-07-26 future-price-btc-a",
    });

    await user.click(tradeDelete);
    expect(repository.save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "Delete future trade ETH 2026-07-26 future-eth-a",
      }),
    ).not.toBeNull();
    await user.click(tradeDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", {
          name: "Delete future trade ETH 2026-07-26 future-eth-a",
        }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", {
        name: "Delete future trade ETH 2026-07-26 future-eth-b",
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
        name: "Delete future trade ETH 2026-07-26 future-eth-a",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Delete future trade ETH 2026-07-26 future-eth-b",
      }),
    ).not.toBeNull();
  });

  it("keeps delete-all two-stage and restores ordinary writes after the final future fact", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();
    const deleteAll = screen.getByRole("button", {
      name: "Delete all invalid future facts",
    });

    await user.click(deleteAll);
    expect(repository.save).not.toHaveBeenCalled();
    expect(screen.getByText("Future-fact correction mode")).not.toBeNull();
    await user.click(deleteAll);

    await waitFor(() => {
      expect(screen.queryByText("Future-fact correction mode")).toBeNull();
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("Saved locally")).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("Current price").closest("fieldset") as HTMLFieldSetElement)
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
      name: "Delete future trade BTC 2026-07-26 future-buy",
    });
    await user.click(buyDelete);
    await user.click(buyDelete);
    expect(
      screen.getByText(
        "Cannot delete: this trade supports a later sell. Delete dependent later sells first.",
      ),
    ).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();

    const sellDelete = screen.getByRole("button", {
      name: "Delete future trade BTC 2026-07-27 future-sell",
    });
    await user.click(sellDelete);
    await user.click(sellDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
    });

    const remainingBuyDelete = screen.getByRole("button", {
      name: "Delete future trade BTC 2026-07-26 future-buy",
    });
    await user.click(remainingBuyDelete);
    await user.click(remainingBuyDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Future-fact correction mode")).toBeNull();
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
      name: "Delete future price BTC 2026-07-26 future-final-price",
    });

    await user.click(remove);
    await user.click(remove);
    expect(screen.queryByText("Future-fact correction mode")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).not.toBeNull();
    });
    expect(screen.queryByText("Saved locally")).toBeNull();
    expect(storedLedger.priceSnapshots).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => {
      expect(screen.getByText("Saved locally")).not.toBeNull();
    });
    expect(storedLedger.priceSnapshots).toEqual([]);

    view.unmount();
    await renderDashboard(repository);
    expect(screen.queryByText("Future-fact correction mode")).toBeNull();
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
        /The current .lftl file is the only authoritative complete ledger/,
      ),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Export complete ledger backup" }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Select ledger backup file"),
    ).toBeTruthy();
    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(createInitialLedgerData()),
    );
    expect(
      await screen.findByText("Historical B Import Preflight Report"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Confirm backup restoration" }),
    ).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Clear local ledger" }),
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
    await screen.findByText(/The current .lftl file is the only authoritative complete ledger/);

    await user.click(
      await screen.findByRole("button", {
        name: "Clear current C ledger",
      }),
    );
    expect(
      screen.getByText(
        /This clears only the current C ledger content. It does not delete the .lftl file or affect other C files/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/previous usable version/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Confirm clearing current C content",
      }),
    );
    expect(
      screen.getByText(
        'Enter the full confirmation text "CLEAR CURRENT C LEDGER".',
      ),
    ).toBeTruthy();
    expect(authorizeReadyClear).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("Enter clear confirmation text"),
      "CLEAR CURRENT C LEDGER",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm clearing current C content",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("The current C ledger content was cleared."),
      ).toBeTruthy();
    });
    expect(authorizeReadyClear).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationNonce: "CLEAR CURRENT C LEDGER",
        sessionId: "dashboard-ready-clear",
        generation: 0,
      }),
    );
    expect(clearReadyLedger).toHaveBeenCalledOnce();
    expect(repository.clear).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Select ledger backup file"),
    ).toBeTruthy();
  });

  it("imports a confirmed backup through the UI and updates every dashboard view", async () => {
    const repository = createMemoryRepository();
    const candidate = createCompleteLedger();
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual prices" }));
    await user.click(
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    );
    expect(getSection("Trade List · 2026-07-14")).not.toBeNull();

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(candidate),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(repository.save).not.toHaveBeenCalled();

    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledWith(candidate);
      expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
      expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
      expect(screen.getByText("Backup restored and saved locally.")).not.toBeNull();
      expect(getSection("Trade List")).not.toBeNull();
      expect(screen.getByText(/1 valued assets; total market value 80000 USD equivalent/)).not.toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Manual prices" }).getAttribute(
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
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(createInitialLedgerData()),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Import failed and the page did not change. No further evidence confirms the underlying storage state; follow the error guidance.",
        ),
      ).not.toBeNull();
    });
    expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
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
      screen.getByLabelText("Select ledger backup file"),
      createRawBackupFile("{", "corrupt.json"),
    );
    await waitFor(() => {
      expect(screen.getByText("Preflight found hard errors; import must not continue.")).not.toBeNull();
      expect(screen.getByText(/BACKUP_BAD_JSON/)).not.toBeNull();
    });

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
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
      screen.getByLabelText("Select ledger backup file"),
      createRawBackupFile(
        serializeBackupEnvelope(unsupportedEnvelope.value),
        "unsupported.json",
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/LEDGER_IMPORT_UNSUPPORTED_VALUATION_CURRENCY/),
      ).not.toBeNull();
      expect(screen.getByText(/Only USD\/USDT valuation is currently supported/)).not.toBeNull();
    });

    expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
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
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(candidate),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Backup restored and saved locally.")).not.toBeNull();
      expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
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
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(createCompleteLedger()),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Import failed and the page did not change. No further evidence confirms the underlying storage state; follow the error guidance.",
        ),
      ).not.toBeNull();
    });
    expect(
      screen.getByText(
        "Local ledger loading failed. Autosave was stopped to avoid overwriting the original data.",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
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
      screen.getByLabelText("Select ledger backup file"),
      createBackupFile(createInitialLedgerData()),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(
        screen.getByText(
          /cancel attempts to restore and reread the complete pre-import C. If restoration cannot be confirmed, the session disables further writes/,
        ),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Current price").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Delete buy BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Clear local ledger",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Export complete ledger backup",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Select ledger backup file") as HTMLInputElement).disabled,
    ).toBe(true);

    saveDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("Backup restored and saved locally.")).not.toBeNull();
    });
  });

  it("does not clear when confirmation is cancelled or the fixed text is wrong", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Clear local ledger" }),
    );
    expect(
      screen.getByText(
        "This permanently deletes custom assets, trades, prices, and fee rules. Export a complete ledger backup first.",
      ),
    ).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );
    expect(
      screen.getByText('Enter the full confirmation text "CLEAR LOCAL LEDGER".'),
    ).not.toBeNull();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Enter clear confirmation text"), "wrong text");
    await user.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );
    expect(repository.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Enter clear confirmation text")).toBeNull();
    expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
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
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    );
    expect(getSection("Trade List · 2026-07-14")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Clear local ledger" }),
    );
    await user.type(
      screen.getByLabelText("Enter clear confirmation text"),
      "CLEAR LOCAL LEDGER",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );

    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
      expect(
        screen.getByText("Clearing the local ledger. Do not close the page."),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Current price").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Delete buy BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Confirm permanent clear",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    clearDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("The ledger was cleared.")).not.toBeNull();
    });

    expect(screen.queryAllByRole("option", { name: "SOL · Solana" })).toEqual([]);
    expect(
      within(getSection("Trade List")).getByText(
        "No trades yet. Added trades will appear here automatically.",
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
        "Local ledger loading failed. Autosave was stopped to avoid overwriting the original data.",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Clear local ledger" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "Clear damaged or unreadable local data",
      }),
    );
    expect(
      screen.getByText(
        "The loading failure may be temporary. Continuing deletes custom assets, trades, prices, and fee rules that may still be recoverable. Restore from a valid backup first or confirm permanent deletion.",
      ),
    ).not.toBeNull();
    await user.type(
      screen.getByLabelText("Enter clear confirmation text"),
      "CLEAR LOCAL LEDGER",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );

    await waitFor(() => {
      expect(screen.getByText("The ledger was cleared.")).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "Clear local ledger" }),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
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
      screen.getByRole("button", { name: "Clear local ledger" }),
    );
    await user.type(
      screen.getByLabelText("Enter clear confirmation text"),
      "CLEAR LOCAL LEDGER",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm permanent clear" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Clearing the local ledger failed. The page and local data were not changed."),
      ).not.toBeNull();
    });
    expect(screen.queryByText("The ledger was cleared.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Retry save" }),
    ).toBeNull();
    expect(within(getSection("Trade List")).getByText("BTC")).not.toBeNull();
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
      screen.getByText(/The current ledger exceeds resource limits and was loaded read-only/),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("Quantity").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Clear local ledger",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });
});
