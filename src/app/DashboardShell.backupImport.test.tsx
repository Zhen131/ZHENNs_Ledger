// @vitest-environment jsdom

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
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
import type { LedgerReadyClearDriver } from "@/platform/persistence";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  createLedgerSession,
  createReadyLedgerClearAuthorizationForDriver,
  LEDGER_FILE_CAPABILITIES,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  DashboardShell,
  createBackupFile,
  createCompleteLedger,
  createDeferred,
  createMemoryRepository,
  createRawBackupFile,
  createSimpleTrade,
  getSection,
  renderDashboard,
} from "./DashboardShell.testHelpers";

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
      await screen.findByText("明文备份预检报告"),
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
    await screen.findByRole("tab", { name: "本地资产与行情" });

    await user.click(
      screen.getByRole("tab", { name: "危险操作" }),
    );
    await user.click(
      screen.getByRole("button", { name: "打开清空账本操作" }),
    );
    expect(
      screen.getByText(
        /自定义资产、交易、价格和手续费规则都会清空/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/不会删除当前 .lftl 文件/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "确认清空账本内容",
      }),
    );
    expect(
      screen.getByText(
        "请输入完整确认文本“清空账本”",
      ),
    ).toBeTruthy();
    expect(authorizeReadyClear).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空账本",
    );
    await user.click(
      screen.getByRole("button", {
        name: "确认清空账本内容",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("当前账本内容已清空，.lftl 文件仍然存在"),
      ).toBeTruthy();
    });
    expect(authorizeReadyClear).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationNonce: "清空当前账本",
        sessionId: "dashboard-ready-clear",
        generation: 0,
      }),
    );
    expect(clearReadyLedger).toHaveBeenCalledOnce();
    expect(repository.clear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "导入与导出" }));
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
      const totalMarketValue = screen
        .getAllByTitle("79999")
        .find((element) =>
          element.closest("p")?.textContent?.includes("几何分配"),
        );
      expect(totalMarketValue?.closest("p")?.textContent).toContain(
        "几何分配 1 项；净总资产 79 999.00 USDT",
      );
      const deficit = screen
        .getAllByTitle("1")
        .find((element) => element.closest("p")?.textContent?.includes("现金缺口"));
      expect(deficit?.closest("p")?.textContent).toBe(
        "现金缺口 1.00 USDT；负现金不绘制为正扇区。",
      );
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
      quoteCurrency: "EUR" as never,
    };

    const validEnvelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56Z",
    });
    expect(validEnvelope.ok).toBe(true);
    if (!validEnvelope.ok) return;
    const futureEnvelope = {
      ...validEnvelope.value,
      ledgerData: futureLedger,
    };
    const unsupportedEnvelope = {
      ...validEnvelope.value,
      ledgerData: unsupportedLedger,
    };

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
        serializeBackupEnvelope(futureEnvelope),
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
        serializeBackupEnvelope(unsupportedEnvelope),
        "unsupported.json",
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/LEDGER_DATA_INVALID_ENTITY/),
      ).not.toBeNull();
      expect(
        screen.getByText(/assets\[0\]\.quoteCurrency must be USDT/),
      ).not.toBeNull();
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
          /取消时会尝试恢复并复读导入前的完整内容；如果无法确认恢复，当前会话会停止后续写入并明确报错/,
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
});
