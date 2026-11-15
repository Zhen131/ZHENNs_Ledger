// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "@root/package.json";
import { createInitialLedgerData } from "@/core/state";
import { parseBackupJson } from "../backupEnvelope";
import { BackupControls } from "../BackupControls";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureDownloadedText(): () => string {
  const OriginalBlob = Blob;
  const parts: BlobPart[][] = [];
  class SpyBlob extends OriginalBlob {
    constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
      parts.push(blobParts ?? []);
      super(blobParts, options);
    }
  }
  vi.stubGlobal("Blob", SpyBlob);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:backup"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return () => {
    const first = parts[0]?.[0];
    if (typeof first !== "string") {
      throw new Error("Expected serialized backup JSON in the download Blob");
    }
    return first;
  };
}

describe("BackupControls export appVersion", () => {
  it("writes the package.json version into the exported backup", async () => {
    const readDownloadedText = captureDownloadedText();
    render(
      <BackupControls
        clock={{ now: () => new Date("2026-07-23T12:34:56.000Z") }}
        hydrationStatus="ready"
        isDirty={false}
        isReadOnly={false}
        ledgerData={createInitialLedgerData()}
        onImport={vi.fn(async () => ({ ok: true }))}
        persistenceOperation="idle"
        persistenceStatus="idle"
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "导出明文账本" }));

    const parsed = parseBackupJson(readDownloadedText());
    if (!parsed.ok) throw new Error("Downloaded backup must remain valid");
    expect(parsed.value.appVersion).toBe(packageJson.version);
  });
});
