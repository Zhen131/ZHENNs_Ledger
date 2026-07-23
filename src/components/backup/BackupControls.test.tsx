// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackupEnvelope, serializeBackupEnvelope } from "../../backup/backupEnvelope";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { createSimpleTrade } from "../../test/fixtures";
import { BackupControls } from "./BackupControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createBackupFile(name = "ledger.json") {
  const envelope = createBackupEnvelope(createInitialLedgerData(), {
    appVersion: "0.1.0",
    exportedAt: "2026-07-23T12:34:56Z",
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");
  const file = new File([serializeBackupEnvelope(envelope.value)], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serializeBackupEnvelope(envelope.value)),
  });
  return file;
}

function renderControls(
  overrides: Partial<ComponentProps<typeof BackupControls>> = {},
) {
  const onImport = vi.fn(async () => ({ ok: true }));
  render(
    <BackupControls
      hydrationStatus="ready"
      isDirty={false}
      isReadOnly={false}
      ledgerData={createInitialLedgerData()}
      onImport={onImport}
      persistenceOperation="idle"
      persistenceStatus="idle"
      {...overrides}
    />,
  );
  return { onImport };
}

describe("BackupControls", () => {
  it("exports the current in-memory ledger rather than reading the repository", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("current-page", "buy", "BTC", "1")],
    };
    renderControls({ ledgerData });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(screen.getByText("已导出备份。备份为明文，未加密。")).not.toBeNull();
  });

  it("checks file size before File.text", async () => {
    renderControls();
    const file = createBackupFile();
    Object.defineProperty(file, "size", { value: 8 * 1024 * 1024 + 1 });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    expect(file.text).not.toHaveBeenCalled();
    expect(screen.getByText("无法导入：文件超过 8 MiB 限制。")).not.toBeNull();
  });

  it("requires confirmation before replacing the ledger", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), createBackupFile());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(onImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });
  });

  it("shows the complete backup candidate and lets the same file be selected after cancel", async () => {
    renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");
    const file = createBackupFile();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(screen.getByText("应用版本")).not.toBeNull();
    expect(screen.getByText("导出时间")).not.toBeNull();
    expect(screen.getByText("资产")).not.toBeNull();
    expect(screen.getByText("交易")).not.toBeNull();
    expect(screen.getByText("价格快照")).not.toBeNull();
    expect(screen.getByText("手续费规则")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
  });

  it("lets the same file be selected after a successful import", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");
    const file = createBackupFile();

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
  });

  it("shows structured parser errors and clears them on a new selection", async () => {
    renderControls();
    const invalidFile = new File(["{"], "invalid.json", {
      type: "application/json",
    });
    Object.defineProperty(invalidFile, "text", {
      configurable: true,
      value: vi.fn(async () => "{"),
    });
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, invalidFile);
    await waitFor(() => {
      expect(screen.getByText(/BACKUP_BAD_JSON/)).not.toBeNull();
      expect(screen.getByText(/发现 1 项导入错误/)).not.toBeNull();
    });

    await user.upload(input, createBackupFile("valid.json"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(screen.queryByText(/BACKUP_BAD_JSON/)).toBeNull();
  });

  it("ignores an earlier file read after the user selects a newer file", async () => {
    renderControls();
    const firstRead = new Promise<string>((resolve) => {
      setTimeout(() => resolve("{"), 20);
    });
    const firstFile = createBackupFile("first.json");
    Object.defineProperty(firstFile, "text", {
      configurable: true,
      value: vi.fn(() => firstRead),
    });
    const secondFile = createBackupFile("second.json");
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, firstFile);
    await user.upload(input, secondFile);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.queryByText("无法导入：备份文件格式或内容无效。")).toBeNull();
    expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
  });

  it("keeps only rescue export available for a read-only ledger", () => {
    renderControls({ isReadOnly: true });

    expect(screen.getByRole("button", { name: "导出完整账本备份" })).not.toBeNull();
    expect(screen.queryByLabelText("选择账本备份文件")).toBeNull();
    expect(screen.getByText(/仅可导出受 8 MiB 限制的救援备份/)).not.toBeNull();
  });

  it("shows recovery import but no export after hydration fails", () => {
    renderControls({ hydrationStatus: "error" });

    expect(screen.queryByRole("button", { name: "导出完整账本备份" })).toBeNull();
    expect(screen.getByLabelText("选择账本备份文件")).not.toBeNull();
    expect(screen.getByText("可使用有效备份恢复本地账本。")).not.toBeNull();
  });
});
