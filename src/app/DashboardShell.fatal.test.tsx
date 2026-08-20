// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import {
  createLedgerSession,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerRepository,
} from "@/platform/persistence";
import type { PersistentLedgerState } from "./usePersistentLedger";
import { usePersistentLedger } from "./usePersistentLedger";
import { DashboardShell } from "./DashboardShell";

vi.mock("./usePersistentLedger", () => ({
  usePersistentLedger: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardShell fatal session handoff", () => {
  it("unmounts the decrypted workspace and hands one current fatal signal to the Gate drain", async () => {
    const repository: LedgerRepository = {
      load: vi.fn(async () => createInitialLedgerData()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      createSessionId: () => "dashboard-fatal-session",
    });
    const drain = vi.fn<PersistentLedgerState["drainForSessionQuiesce"]>();
    const fatalSignal = Object.freeze({
      code: "IMPORT_RECOVERY_BLOCKED" as const,
      occurrence: 1,
      sessionId: session.sessionId,
      sessionGeneration: session.generation,
    });
    vi.mocked(usePersistentLedger).mockReturnValue({
      ledgerData: createInitialLedgerData(),
      applyLedgerAction: vi.fn<PersistentLedgerState["applyLedgerAction"]>(
        () => "rejected",
      ),
      applyLedgerMutation: vi.fn<
        PersistentLedgerState["applyLedgerMutation"]
      >(() => "rejected"),
      hydrationStatus: "ready",
      persistenceError: "fatal import recovery",
      resourcePolicyError: null,
      isReadOnly: true,
      retryPersistence: vi.fn(async () => false),
      canRetryPersistence: false,
      clearLedger: vi.fn(async () => ({
        ok: false as const,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED" as const,
      })),
      replaceLedgerFromBackup: vi.fn(async () => ({
        ok: false as const,
        code: "LEDGER_IMPORT_NOT_ALLOWED" as const,
      })),
      persistenceOperation: "idle",
      persistenceStatus: "error",
      mutationVersion: 0,
      persistedVersion: 0,
      isDirty: false,
      repositorySwitchBlocked: false,
      discardDirtyChangesAndSwitchRepository: vi.fn(() => false),
      ledgerEpoch: 0,
      compatibilityWarnings: [],
      isFutureFactCorrectionMode: false,
      todayKey: "2026-08-20",
      lifecycleStatus: "quiescing",
      sessionFatalSignal: fatalSignal,
      drainForSessionQuiesce: drain,
    });
    const onSessionFatal = vi.fn(async () => undefined);
    const rendered = render(
      <DashboardShell
        onSessionFatal={onSessionFatal}
        session={session}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "正在自动关闭账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("总资产")).toBeNull();
    await waitFor(() => {
      expect(onSessionFatal).toHaveBeenCalledOnce();
    });
    expect(onSessionFatal).toHaveBeenCalledWith(
      drain,
      fatalSignal,
    );

    rendered.rerender(
      <DashboardShell
        onSessionFatal={onSessionFatal}
        session={session}
      />,
    );
    expect(onSessionFatal).toHaveBeenCalledOnce();
  });
});
