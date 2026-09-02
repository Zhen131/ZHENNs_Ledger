// @vitest-environment jsdom

import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
} from "vitest";
import { preflightBackupJson } from "@/features/backup";
import { createInitialLedgerData } from "@/core/state";
import { usePersistentLedger } from "./usePersistentLedger";
import {
  FIXED_CLOCK,
  createHarness,
  evidenceFromPreflight,
  readFixture,
  readPreflight,
} from "./usePersistentLedger.fileImport.testHelpers";

describe("usePersistentLedger ready C import", () => {
  it(
    "publishes the exact verified 300-trade candidate only after the repository readback succeeds",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      expect(preflight.hardErrorCount).toBe(0);
      expect(preflight.suspiciousGroupCount).toBe(0);
      expect(preflight.candidate?.trades).toHaveLength(300);
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const readbackGate = handle.pauseNextReadAfterClose();
      const { result } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importResult:
        | Awaited<
            ReturnType<
              typeof result.current.replaceLedgerFromBackup
            >
          >
        | undefined;
      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            {
              now: FIXED_CLOCK.now(),
              todayKey: "2026-07-31",
            },
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await readbackGate.started;
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.persistenceOperation).toBe(
        "importing",
      );
      readbackGate.release();
      await act(async () => {
        importResult = await importPromise;
      });

      expect(importResult).toEqual({ ok: true });
      expect(result.current.ledgerData).toEqual(
        preflight.candidate,
      );
      expect(result.current.ledgerData.trades).toHaveLength(300);
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.isDirty).toBe(false);
      await expect(repository.load()).resolves.toEqual(
        preflight.candidate,
      );
    },
    20_000,
  );

  it(
    "imports a normal ledger schema V4 backup without requiring historical Trade.rawText",
    async () => {
      const parsed = JSON.parse(
        readFixture("valid-300.backup.json"),
      );
      delete parsed.ledgerData.trades[0].rawText;
      const preflight = await preflightBackupJson(
        `${JSON.stringify(parsed, null, 2)}\n`,
        {
          todayKey: "2026-07-31",
          selectionGeneration: 2,
          requireHistoricalRawText: false,
        },
      );
      expect(preflight.hardErrorCount).toBe(0);
      expect(preflight.candidate?.trades[0].rawText).toBeUndefined();
      if (!preflight.candidate) return;

      const { repository, session } = await createHarness();
      const { result } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      await act(async () => {
        await expect(
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          ),
        ).resolves.toEqual({ ok: true });
      });

      expect(result.current.ledgerData.trades[0].rawText).toBeUndefined();
      await expect(repository.load()).resolves.toEqual(
        preflight.candidate,
      );
    },
    20_000,
  );

  it(
    "publishes one current-session fatal signal and permanently stops the Hook when import recovery is blocked",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const candidateBeforeImport = JSON.stringify(preflight.candidate);
      const { handle, repository, session } = await createHarness();
      const { result, rerender } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });
      const writesBeforeImport = handle.writeCount;
      handle.mutateAfterClose = (serialized) => {
        handle.failNextRead = true;
        handle.failNextWrite = true;
        return serialized;
      };

      await act(async () => {
        await expect(
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          ),
        ).resolves.toEqual({
          ok: false,
          code: "LEDGER_IMPORT_RECOVERY_BLOCKED",
        });
      });

      expect(result.current.sessionFatalSignal).toMatchObject({
        code: "IMPORT_RECOVERY_BLOCKED",
        occurrence: 1,
        sessionId: session.sessionId,
        sessionGeneration: 0,
      });
      const fatalSignal = result.current.sessionFatalSignal;
      expect(result.current.lifecycleStatus).toBe("quiescing");
      expect(result.current.persistenceStatus).toBe("error");
      expect(result.current.ledgerData).toEqual(createInitialLedgerData());
      expect(result.current.mutationVersion).toBe(0);
      expect(result.current.persistedVersion).toBe(0);
      expect(JSON.stringify(preflight.candidate)).toBe(candidateBeforeImport);
      const writesAfterBlocked = handle.writeCount;
      expect(writesAfterBlocked).toBe(writesBeforeImport + 2);

      expect(
        result.current.applyLedgerMutation((ledger) => ({
          ...ledger,
          updatedAt: "2026-07-31T12:01:00.000Z",
        })),
      ).toBe("rejected");
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
      await expect(result.current.retryPersistence()).resolves.toBe(false);
      expect(handle.writeCount).toBe(writesAfterBlocked);

      rerender();
      expect(result.current.sessionFatalSignal).toBe(fatalSignal);
      await expect(repository.load()).rejects.toMatchObject({
        code: "LEDGER_FILE_IMPORT_RECOVERY_BLOCKED",
      });
    },
    20_000,
  );

  it("keeps the 147th-trade hard-error fixture outside the ready-import driver with zero C writes", async () => {
    const serialized = readFixture(
      "invalid-trade-147.backup.json",
    );
    const preflight = await readPreflight(
      "invalid-trade-147.backup.json",
    );
    const invalidCandidate = JSON.parse(serialized).ledgerData;
    const { handle, repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const closesBeforeImport = handle.closeCount;

    expect(preflight.hardErrorCount).toBeGreaterThan(0);
    expect(preflight.candidate).toBeUndefined();
    expect(
      preflight.retainedDetails.some(
        (detail) =>
          detail.kind === "hard-error" &&
          detail.path === "trades[146].quantity",
      ),
    ).toBe(true);

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          invalidCandidate,
          undefined,
          {
            contentIdentity: preflight.contentIdentity.value,
            candidateIdentity: "invalid-candidate",
            selectionGeneration: preflight.selectionGeneration,
            hardErrorCount: preflight.hardErrorCount,
            suspiciousGroupCount: preflight.suspiciousGroupCount,
            suspiciousGroupIdentity:
              preflight.suspiciousGroupIdentity,
            confirmedSuspiciousGroupIdentity: null,
            requireHistoricalRawText: true,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_INVALID_BACKUP",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.closeCount).toBe(closesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects a V4 B with an absent Binance mapping before any file write", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.assets[0].binanceMapping;
    const preflight = await preflightBackupJson(
      `${JSON.stringify(parsed, null, 2)}\n`,
      {
        todayKey: "2026-07-31",
        selectionGeneration: 2,
        requireHistoricalRawText: true,
      },
    );
    expect(preflight.hardErrorCount).toBeGreaterThan(0);
    expect(preflight.candidate).toBeUndefined();
    expect(preflight.candidateIdentity).toBeUndefined();
    const { handle } = await createHarness();
    const writesAfterCreate = handle.writeCount;
    expect(handle.writeCount).toBe(writesAfterCreate);
  });

  it("rejects forged zero-error evidence when a historical trade has no rawText", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.trades[146].rawText;
    const { handle, repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          parsed.ledgerData,
          undefined,
          {
            contentIdentity: "forged-content",
            candidateIdentity: "forged-candidate",
            selectionGeneration: 1,
            hardErrorCount: 0,
            suspiciousGroupCount: 0,
            suspiciousGroupIdentity: "forged-groups",
            confirmedSuspiciousGroupIdentity: null,
            requireHistoricalRawText: true,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_INVALID_BACKUP",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects forged normal-restore evidence even though Trade.rawText is optional", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.trades[0].rawText;
    const { handle, repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          parsed.ledgerData,
          undefined,
          {
            contentIdentity: "forged-content",
            candidateIdentity: "forged-candidate",
            selectionGeneration: 1,
            hardErrorCount: 0,
            suspiciousGroupCount: 0,
            suspiciousGroupIdentity: "forged-groups",
            confirmedSuspiciousGroupIdentity: null,
            requireHistoricalRawText: false,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects an already-cancelled selection before ready-import authorization or writable creation", async () => {
    const preflight = await readPreflight(
      "valid-300.backup.json",
    );
    if (!preflight.candidate) return;
    const { handle, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          controller.signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_CANCELLED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
  });
});
