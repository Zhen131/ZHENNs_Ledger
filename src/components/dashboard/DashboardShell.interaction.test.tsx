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
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import {
  createAsset,
  createPriceSnapshot,
  createSimpleTrade,
} from "../../test/fixtures";
import { DashboardShell } from "./DashboardShell";

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
  await user.type(screen.getByLabelText("总金额"), "70");
  await user.type(screen.getByLabelText("日期"), "2026-07-14");

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
  await user.type(screen.getByLabelText("总金额"), input.totalValue);

  const occurredAtInput = screen.getByLabelText("日期");
  if ((occurredAtInput as HTMLInputElement).value !== input.occurredAt) {
    await user.clear(occurredAtInput);
    await user.type(occurredAtInput, input.occurredAt);
  }

  await user.click(screen.getByRole("button", { name: "保存交易" }));
  return user;
}

describe("DashboardShell trade interactions", () => {
  it("separates an accepted trade from pending and completed local persistence", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository();
    repository.save = vi.fn(() => saveDeferred.promise);
    await renderDashboard(repository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(screen.getByText("交易已加入账本")).not.toBeNull();
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("正在保存到本地")).not.toBeNull();
    });
    expect(screen.queryByText("已保存到本地")).toBeNull();

    saveDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
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

    expect(screen.getByText("交易已加入账本")).not.toBeNull();

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("买入")).not.toBeNull();
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByText("70000 USD")).not.toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    await renderDashboard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "0.001");
    await user.type(screen.getByLabelText("成交均价"), "70000");
    await user.type(screen.getByLabelText("总金额"), "10");
    await user.type(screen.getByLabelText("日期"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByText("总金额与数量 × 成交均价不一致"),
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

    await user.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }),
    );

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，删除后持仓时间线会失效",
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
    await user.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }),
    );

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

    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expect(screen.getByText("价格已加入账本")).not.toBeNull();

    const positionSection = getSection("资产汇总");
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
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("80000 USD")).not.toBeNull();
    expect(within(positionSection).getByText("80 USD")).not.toBeNull();
    expect(within(positionSection).getByText("10 USD")).not.toBeNull();

    const secondUser = userEvent.setup();
    await secondUser.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }),
    );
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
});

describe("DashboardShell data management", () => {
  it("imports a confirmed backup through the UI and updates every dashboard view", async () => {
    const repository = createMemoryRepository();
    const candidate = createCompleteLedger();
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFile(candidate),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(repository.save).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledWith(candidate);
      expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
      expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });
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
    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));

    await waitFor(() => {
      expect(
        screen.getByText("恢复写入失败，当前页面与本地记录未变更。"),
      ).not.toBeNull();
    });
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).toHaveBeenCalledOnce();
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
    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));

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
    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));

    await waitFor(() => {
      expect(
        screen.getByText("恢复写入失败，当前页面与本地记录未变更。"),
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
    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(
        screen.getByText("正在恢复备份，请勿关闭页面。"),
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
