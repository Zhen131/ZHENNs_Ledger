// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createBackupFilename, downloadBackupJson } from "./backupDownload";

describe("backup download", () => {
  it("uses a stable UTC filename", () => {
    expect(createBackupFilename("2026-07-23T12:34:56.789Z")).toBe(
      "local-first-trading-ledger-backup-v1-20260723-123456Z.json",
    );
  });

  it("creates JSON blob download and revokes the object URL", () => {
    const createObjectUrl = vi.fn(() => "blob:backup");
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    downloadBackupJson("{}\n", "2026-07-23T12:34:56Z");

    expect(createObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/json;charset=utf-8" }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
