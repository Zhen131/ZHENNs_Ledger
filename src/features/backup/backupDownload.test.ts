// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createBackupFilename, downloadBackupJson } from "./backupDownload";

describe("backup download", () => {
  it("uses a stable UTC filename", () => {
    expect(createBackupFilename("2026-07-23T12:34:56.789Z")).toBe(
      "local-first-trading-ledger-backup-v1-20260723-123456Z.json",
    );
  });

  it("creates JSON blob download, revokes the object URL and reports success", () => {
    const createObjectUrl = vi.fn(() => "blob:backup");
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    const result = downloadBackupJson("{}\n", "2026-07-23T12:34:56Z");

    expect(result).toEqual({
      ok: true,
      filename: "local-first-trading-ledger-backup-v1-20260723-123456Z.json",
    });
    expect(createObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/json;charset=utf-8" }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("reports Blob construction failure without creating an object URL", () => {
    const createObjectUrl = vi.fn();
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal(
      "Blob",
      vi.fn(() => {
        throw new Error("blob failed");
      }),
    );
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    expect(downloadBackupJson("{}\n", "2026-07-23T12:34:56Z")).toEqual({
      ok: false,
      code: "BACKUP_DOWNLOAD_BLOB_FAILED",
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("reports object URL creation failure without clicking or revoking", () => {
    const createObjectUrl = vi.fn(() => {
      throw new Error("object URL failed");
    });
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    expect(downloadBackupJson("{}\n", "2026-07-23T12:34:56Z")).toEqual({
      ok: false,
      code: "BACKUP_DOWNLOAD_OBJECT_URL_FAILED",
    });
    expect(click).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("reports click failure and still revokes the object URL", () => {
    const createObjectUrl = vi.fn(() => "blob:backup");
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click failed");
    });
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    expect(downloadBackupJson("{}\n", "2026-07-23T12:34:56Z")).toEqual({
      ok: false,
      code: "BACKUP_DOWNLOAD_CLICK_FAILED",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not report success when object URL revocation fails", () => {
    const createObjectUrl = vi.fn(() => "blob:backup");
    const revokeObjectUrl = vi.fn(() => {
      throw new Error("revoke failed");
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    expect(downloadBackupJson("{}\n", "2026-07-23T12:34:56Z")).toEqual({
      ok: false,
      code: "BACKUP_DOWNLOAD_REVOKE_FAILED",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");

    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
