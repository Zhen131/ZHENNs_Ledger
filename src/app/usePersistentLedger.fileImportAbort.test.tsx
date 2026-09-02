// @vitest-environment jsdom

import { Suspense, startTransition, useState } from "react";
import {
  act,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
} from "vitest";
import {
  claimLedgerSessionPersistencePort,
  type LedgerSession,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { ledgerFileTestStringToBytes } from "@/test-support";
import { usePersistentLedger } from "./usePersistentLedger";
import {
  FIXED_CLOCK,
  ImportLedgerHandle,
  createHarness,
  evidenceFromPreflight,
  readPreflight,
} from "./usePersistentLedger.fileImport.testHelpers";

describe("usePersistentLedger ready C import", () => {
  it(
    "aborts and restores an in-flight candidate before quiesce drain can issue its token",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const baseline = handle.text();
      const closeGate = handle.pauseNextClose();
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

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;

      let drainPromise!: ReturnType<
        typeof result.current.drainForSessionQuiesce
      >;
      act(() => {
        const request = session.beginQuiesce("immediate-lock");
        drainPromise =
          result.current.drainForSessionQuiesce(request);
      });
      let drainSettled = false;
      void drainPromise.then(() => {
        drainSettled = true;
      });
      await Promise.resolve();
      expect(drainSettled).toBe(false);
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({
          ok: false,
          code: "LEDGER_IMPORT_BASE_RESTORED",
        });
      });
      await expect(drainPromise).resolves.toMatchObject({
        sessionId: session.sessionId,
        generation: session.generation,
      });
      expect(handle.text()).toBe(baseline);
      await expect(repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.persistenceError).toBe(
        "导入未完成；已复读确认原账本文件恢复为导入前的完整版本，页面没有替换。",
      );
    },
    20_000,
  );

  it(
    "restores the old C when the Hook unmounts after the candidate close starts",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const baseline = handle.text();
      const closeGate = handle.pauseNextClose();
      const { result, unmount } = renderHook(() =>
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

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;
      unmount();
      closeGate.release();

      await expect(importPromise).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_BASE_RESTORED",
      });
      expect(handle.text()).toBe(baseline);
      await expect(repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
    },
    20_000,
  );

  it(
    "aborts and restores the old C before switching to another ledger-file session",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const original = await createHarness();
      const replacement = await createHarness(
        new ImportLedgerHandle("hook-import-replacement.lftl"),
      );
      const originalBaseline = original.handle.text();
      const replacementWrites =
        replacement.handle.writeCount;
      const replacementCloses =
        replacement.handle.closeCount;
      const closeGate = original.handle.pauseNextClose();
      const { result, rerender } = renderHook(
        ({ session }) =>
          usePersistentLedger(
            session.repository,
            FIXED_CLOCK,
            session.capabilities,
            session,
          ),
        { initialProps: { session: original.session } },
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;

      rerender({ session: replacement.session });
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({
          ok: false,
          code: "LEDGER_IMPORT_BASE_RESTORED",
        });
      });
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
        expect(result.current.repositorySwitchBlocked).toBe(false);
      });
      expect(original.handle.text()).toBe(originalBaseline);
      await expect(original.repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
      expect(replacement.handle.writeCount).toBe(
        replacementWrites,
      );
      expect(replacement.handle.closeCount).toBe(
        replacementCloses,
      );
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
    },
    20_000,
  );

  it(
    "does not claim the proposed session or cancel the current import when a concurrent render is abandoned before commit",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const original = await createHarness();
      const replacement = await createHarness(
        new ImportLedgerHandle("abandoned-render.lftl"),
      );
      const closeGate = original.handle.pauseNextClose();
      const neverCommit = new Promise<void>(() => undefined);
      let committedState: ReturnType<typeof usePersistentLedger> | null = null;
      let requestSessionSwitch: (() => void) | null = null;
      let abandonedRenderCount = 0;

      function HookProbe({ session }: { session: LedgerSession }) {
        const state = usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        );
        if (session === replacement.session) {
          abandonedRenderCount += 1;
          throw neverCommit;
        }
        committedState = state;
        return null;
      }

      function ConcurrentHarness() {
        const [session, setSession] = useState(original.session);
        requestSessionSwitch = () => setSession(replacement.session);
        return (
          <Suspense fallback={null}>
            <HookProbe session={session} />
          </Suspense>
        );
      }

      const view = render(<ConcurrentHarness />);
      await waitFor(() => {
        expect(committedState?.hydrationStatus).toBe("ready");
      });
      const readCommittedState = () => {
        if (!committedState) {
          throw new Error("committed Hook state is unavailable");
        }
        return committedState;
      };

      let importPromise!: ReturnType<
        ReturnType<typeof usePersistentLedger>["replaceLedgerFromBackup"]
      >;
      act(() => {
        importPromise = readCommittedState().replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          new AbortController().signal,
        );
      });
      await closeGate.started;

      act(() => {
        startTransition(() => requestSessionSwitch?.());
      });
      await waitFor(() => {
        expect(abandonedRenderCount).toBeGreaterThan(0);
      });

      expect(() =>
        claimLedgerSessionPersistencePort(
          replacement.session,
          {},
        ),
      ).not.toThrow();
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({ ok: true });
      });
      expect(readCommittedState().ledgerData.trades).toHaveLength(300);
      view.unmount();
    },
    20_000,
  );

  it("reports a pre-write external C change without claiming recovery or creating a writable", async () => {
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
    const writablesBeforeImport = handle.createWritableCount;
    const externallyChanged = ledgerFileTestStringToBytes(
      `${handle.text()}\n`,
    );
    const exactExternalBytes = new Uint8Array(
      new ArrayBuffer(externallyChanged.byteLength),
    );
    exactExternalBytes.set(externallyChanged);
    handle.bytes = exactExternalBytes;

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
        code: "LEDGER_IMPORT_SOURCE_CHANGED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.createWritableCount).toBe(
      writablesBeforeImport,
    );
    expect(result.current.persistenceError).toBe(
      "导入写入前发现账本文件已在本页面之外发生变化；本次导入没有写入，请重新打开该文件。",
    );
  });

  it("reports an authorization mismatch without claiming that C was restored", async () => {
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
    const evidence = {
      ...evidenceFromPreflight(preflight),
      candidateIdentity: "sha256:forged:0",
    };

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidence,
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.persistenceError).toBeNull();
  });

  it("reports an unexpected pre-write read failure without inventing restoration evidence", async () => {
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
    handle.failNextRead = true;

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
        code: "LEDGER_REPOSITORY_WRITE_FAILED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.persistenceError).toBe(
      "导入在写入账本文件前失败，页面没有替换；未取得“原文件已恢复”的事后证据。",
    );
  });
});
