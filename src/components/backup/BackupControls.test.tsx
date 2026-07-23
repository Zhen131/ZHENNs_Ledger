// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "../../backup/backupEnvelope";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { createSimpleTrade } from "../../test/fixtures";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "../../validators";
import { BackupControls } from "./BackupControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FIXED_EXPORTED_AT = "2026-07-23T12:34:56.000Z";

function byteLength(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

function padSerializedBackupToBytes(serialized: string, targetBytes: number): string {
  const currentBytes = byteLength(serialized);

  if (currentBytes > targetBytes) {
    throw new Error("Serialized fixture already exceeds target");
  }

  return `${serialized}${" ".repeat(targetBytes - currentBytes)}`;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createBackupFile(name = "ledger.json") {
  const envelope = createBackupEnvelope(createInitialLedgerData(), {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
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

function createPaddedBackupFile(serialized: string, name = "ledger.json") {
  const file = new File([serialized], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return file;
}

function createReadOnlyLedgerAtBackupBytes(targetBytes: number) {
  const ledgerData = {
    ...createInitialLedgerData(),
    trades: [
      {
        ...createSimpleTrade("boundary", "buy", "BTC", "1"),
        rawText: "",
      },
    ],
  };
  const envelope = createBackupEnvelope(ledgerData, {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");

  const serialized = serializeBackupEnvelope(envelope.value);
  ledgerData.trades[0].rawText = "x".repeat(targetBytes - byteLength(serialized));
  return ledgerData;
}

function stubBlobConstructor() {
  const OriginalBlob = Blob;
  const blobConstructor = vi.fn();
  class SpyBlob extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      blobConstructor(parts, options);
      super(parts, options);
    }
  }

  vi.stubGlobal("Blob", SpyBlob);
  return blobConstructor;
}

function renderControls(
  overrides: Partial<ComponentProps<typeof BackupControls>> = {},
) {
  const onImport = vi.fn(async () => ({ ok: true }));
  const view = render(
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
  return { onImport, ...view };
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

  it("creates one backup Blob when the serialized envelope is exactly 8 MiB", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(blobConstructor).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("does not construct a Blob when the serialized envelope exceeds 8 MiB by one byte", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(blobConstructor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "无法导出：当前 v1 无法安全导出该超大账本；未创建备份文件。",
      ),
    ).not.toBeNull();
  });

  it("rejects a real legal backup that exceeds 8 MiB by one byte before File.text", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const exactLimit = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const serialized = `${exactLimit} `;
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1);
    expect(parseBackupJson(serialized)).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "LEDGER_RESOURCE_FILE_TOO_LARGE" }),
      ],
    });
    expect(file.text).not.toHaveBeenCalled();
    expect(screen.getByText("无法导入：文件超过 8 MiB 限制。")).not.toBeNull();
  });

  it("accepts a real legal backup whose content is exactly 8 MiB", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const serialized = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(byteLength(serialized)).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(parseBackupJson(serialized)).toEqual({
      ok: true,
      value: expect.any(Object),
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(file.text).toHaveBeenCalledOnce();
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

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after the user cancels",
    async (settlement) => {
      renderControls();
      const read = createDeferred<string>();
      const file = createBackupFile("pending.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("选择账本备份文件"), file);
      expect(screen.getByText("正在读取备份文件。")).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "取消" }));

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
      expect(screen.queryByText("无法读取备份文件。")).toBeNull();
      expect(
        screen.queryByText("无法导入：备份文件格式或内容无效。"),
      ).toBeNull();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after unmount",
    async (settlement) => {
      const read = createDeferred<string>();
      const file = createBackupFile("pending-unmount.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const view = renderControls();
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("选择账本备份文件"), file);
      view.unmount();

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  );

  it("states that a read-only rescue backup may not be importable", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    renderControls({ isReadOnly: true });
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "导出完整账本备份" })).not.toBeNull();
    expect(screen.queryByLabelText("选择账本备份文件")).toBeNull();
    expect(
      screen.getByText(
        /备份可能因集合或字符串超限而无法由当前版本重新导入/,
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        /已导出只读救援备份.*可能因集合或字符串超限而无法由当前版本重新导入/,
      ),
    ).not.toBeNull();
  });

  it("shows recovery import but no export after hydration fails", () => {
    renderControls({ hydrationStatus: "error" });

    expect(screen.queryByRole("button", { name: "导出完整账本备份" })).toBeNull();
    expect(screen.getByLabelText("选择账本备份文件")).not.toBeNull();
    expect(screen.getByText("可使用有效备份恢复本地账本。")).not.toBeNull();
  });
});
