import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import { createInitialLedgerData } from "@/core/state";
import {
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  LedgerSessionLifecycleError,
} from "@/platform/persistence";
import { LedgerFileRepository } from "./ledgerFileRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
} from "./ledgerFileRepositoryContract";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import { readLedgerFileForTest } from "@/test-support";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  createReadyClearSession,
  invokeRawReadyClear,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createLedgerWithTrades,
  readVerifiedFile,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it("keeps generic clear fail-closed without writing", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    await expect(repository.clear()).rejects.toMatchObject({
      code: "LEDGER_REPOSITORY_CLEAR_FAILED",
    });
    expect(handle.writeCount).toBe(1);
  });

  it("forces an authorized ready clear into a new verified current while preserving the prior current as previous", async () => {
    const handle = new AtomicLedgerHandle();
    const originalLedger = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      originalLedger,
      {
        generateId: createIdGenerator([
          "file-clear",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const before = readLedgerFileForTest(handle.text());
    expect(
      repository.authorizeReadyClear({
        sessionId: "forged-direct-call",
        generation: 0,
        confirmationNonce: "清空当前账本",
      }),
    ).toBeNull();
    const session = createReadyClearSession(
      repository,
      "ready-clear-session",
    );
    expect(
      session.readyClearPort?.authorizeReadyClear("任意非空文本"),
    ).toBeNull();
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    const writesBeforeClear = handle.writeCount;
    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
        {
          sessionId: session.sessionId,
          generation: session.generation,
        },
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesBeforeClear);
    await session.readyClearPort.clearReadyLedger(authorization);

    const after = readLedgerFileForTest(handle.text());
    expect(after.fileId).toBe(before.fileId);
    expect(after.crypto).toEqual(before.crypto);
    expect(after.current.revisionId).toBe(
      "revision-after-clear",
    );
    expect(after.current.parentRevisionId).toBe(
      "revision-before-clear",
    );
    expect(after.previous).toEqual(before.current);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(2);
  });

  it("forces a new revision, IV, and savedAt even when the current ledger is already empty", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-empty-clear",
          "revision-empty-before",
          "revision-empty-after",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const before = await readVerifiedFile(handle);
    const session = createReadyClearSession(
      repository,
      "ready-empty-clear",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    await session.readyClearPort.clearReadyLedger(authorization);

    const after = await readVerifiedFile(handle);
    expect(after.file.current.revisionId).toBe(
      "revision-empty-after",
    );
    expect(after.file.current.ivBase64Url).not.toBe(
      before.file.current.ivBase64Url,
    );
    expect(after.current.savedAt).toBe(
      "2026-07-28T10:01:00.000Z",
    );
    expect(after.file.previous).toEqual(before.file.current);
    expect(handle.writeCount).toBe(2);
  });

  it("never writes the clear confirmation nonce into the file", async () => {
    // The nonce is an in-memory authorization token. Renaming it has to be a
    // display-level change with no stored value behind it, so this test looks
    // for it in both places it could hide: the raw bytes on disk, and the
    // decrypted payload inside them (04A D-17d).
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "nonce-never-stored",
          "revision-before-nonce-clear",
          "revision-after-nonce-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-nonce-never-stored",
    );
    const authorization = session.readyClearPort?.authorizeReadyClear(
      READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
    );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    await session.readyClearPort.clearReadyLedger(authorization);

    // Anchor first, so a scan of an empty or unreadable buffer cannot pass by
    // finding nothing.
    expect(handle.text()).toContain("fileFormatVersion");
    expect(handle.text()).not.toContain(READY_LEDGER_CLEAR_CONFIRMATION_TEXT);
    expect(handle.text()).not.toContain("confirmationNonce");
    const after = await readVerifiedFile(handle);
    expect(JSON.stringify(after)).not.toContain(
      READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
    );
    expect(JSON.stringify(after)).not.toContain("confirmationNonce");
    expect(after.current.ledgerData.trades).toEqual([]);
  });

  it("clears only the selected C and the same file reopens with the verified empty current", async () => {
    const selectedHandle = new AtomicLedgerHandle("selected.lftl");
    const otherHandle = new AtomicLedgerHandle("other.lftl");
    const selected = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      selectedHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "selected-file",
          "selected-before",
          "selected-after",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const otherLedger = createLedgerWithTrades(2);
    const other = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      otherHandle,
      PASSPHRASE,
      otherLedger,
      {
        generateId: createIdGenerator([
          "other-file",
          "other-revision",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const otherBefore = otherHandle.bytes.slice();
    const session = createReadyClearSession(
      selected,
      "selected-clear-session",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    await session.readyClearPort.clearReadyLedger(authorization);

    expect(otherHandle.bytes).toEqual(otherBefore);
    await expect(other.load()).resolves.toEqual(otherLedger);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      selectedHandle,
      PASSPHRASE,
      {
        expectedFileId: "selected-file",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(selectedHandle.name).toBe("selected.lftl");
  });

  it("rejects stale and cross-repository clear authorizations with zero clear writes", async () => {
    const firstHandle = new AtomicLedgerHandle("first.lftl");
    const secondHandle = new AtomicLedgerHandle("second.lftl");
    const first = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      firstHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-first",
          "revision-first",
          "revision-first-save",
          "unused-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const second = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      secondHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-second",
          "revision-second",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const firstSession = createReadyClearSession(
      first,
      "ready-clear-session",
    );
    const secondSession = createReadyClearSession(
      second,
      "ready-clear-second-session",
    );
    const authorization =
      firstSession.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (
      !authorization ||
      !firstSession.readyClearPort ||
      !secondSession.readyClearPort
    ) {
      return;
    }

    expect(() =>
      secondSession.readyClearPort?.clearReadyLedger(
        authorization,
      ),
    ).toThrow(LedgerSessionLifecycleError);
    await first.save(createLedgerWithTrades(2));
    const writesAfterSave = firstHandle.writeCount;
    await expect(
      firstSession.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(firstHandle.writeCount).toBe(writesAfterSave);
    expect(secondHandle.writeCount).toBe(1);
  });

  it("rejects a raw ready clear after quiesce even when its authorization was valid before lock", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-after-quiesce",
          "revision-before-quiesce",
          "unused-clear-revision",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-after-quiesce",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    const writesBeforeQuiesce = handle.writeCount;

    session.beginQuiesce("immediate-lock");

    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(() =>
      session.readyClearPort?.clearReadyLedger(authorization),
    ).toThrow(LedgerSessionLifecycleError);
    expect(handle.writeCount).toBe(writesBeforeQuiesce);
  });

  it("reconciles the same clear intent after an uncertain readback without creating another generation", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-retry",
          "revision-before-clear",
          "revision-clear-intent",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.failReadAfterClose = true;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const committedButUnconfirmed = handle.text();
    const writesAfterUncertainReadback = handle.writeCount;

    await session.readyClearPort.clearReadyLedger(authorization);

    expect(handle.writeCount).toBe(writesAfterUncertainReadback);
    expect(handle.text()).toBe(committedButUnconfirmed);
    const file = readLedgerFileForTest(handle.text());
    expect(file.current.revisionId).toBe("revision-clear-intent");
    expect(file.previous?.revisionId).toBe(
      "revision-before-clear",
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it.each(["write", "close"] as const)(
    "does not publish clear success after a %s failure and retries the same intent",
    async (failure) => {
      const handle = new AtomicLedgerHandle();
      const original = createLedgerWithTrades(1);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        original,
        {
          generateId: createIdGenerator([
            `file-clear-${failure}-failure`,
            "revision-before-clear",
            "revision-clear-intent",
          ]),
          now: createClock([
            "2026-07-28T10:00:00.000Z",
            "2026-07-28T10:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const baseBytes = handle.bytes.slice();
      const session = createReadyClearSession(
        repository,
        `ready-clear-${failure}-failure`,
      );
      const authorization =
        session.readyClearPort?.authorizeReadyClear(
          "清空当前账本",
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyClearPort) return;
      if (failure === "write") {
        handle.failNextWrite = true;
      } else {
        handle.failNextClose = true;
      }

      await expect(
        session.readyClearPort.clearReadyLedger(authorization),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      });
      expect(handle.bytes).toEqual(baseBytes);
      await expect(repository.load()).resolves.toEqual(original);
      const retryAuthorization =
        session.readyClearPort.authorizeReadyClear(
          "清空当前账本",
        );
      expect(retryAuthorization).toBe(authorization);
      if (!retryAuthorization) return;

      await session.readyClearPort.clearReadyLedger(
        retryAuthorization,
      );
      const verified = await readVerifiedFile(handle);
      expect(verified.file.current.revisionId).toBe(
        "revision-clear-intent",
      );
      expect(verified.file.previous?.revisionId).toBe(
        "revision-before-clear",
      );
      expect(verified.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
    },
  );

  it("reuses the same authorization when clear fails before creating an intent", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-pre-intent-retry",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-pre-intent-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.failNextRead = true;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const retriedAuthorization =
      session.readyClearPort.authorizeReadyClear(
        "清空当前账本",
      );
    expect(retriedAuthorization).toBe(authorization);
    if (!retriedAuthorization) return;

    await session.readyClearPort.clearReadyLedger(
      retriedAuthorization,
    );
    expect(handle.writeCount).toBe(2);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("keeps a lease-rejected clear at zero writes and permits only the same authorized retry", async () => {
    let rejectNextExclusiveWrite = false;
    const lease: LedgerFileSessionLease = {
      sessionId: "clear-lease-retry",
      runExclusiveWrite: async (operation) => {
        if (rejectNextExclusiveWrite) {
          rejectNextExclusiveWrite = false;
          throw new Error("lease rejected clear");
        }
        return operation();
      },
      release: async () => undefined,
    };
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-lease-retry",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: lease,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-lease-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    rejectNextExclusiveWrite = true;
    const writesBeforeClear = handle.writeCount;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toThrow("lease rejected clear");
    expect(handle.writeCount).toBe(writesBeforeClear);
    const retryAuthorization =
      session.readyClearPort.authorizeReadyClear(
        "清空当前账本",
      );
    expect(retryAuthorization).toBe(authorization);
    if (!retryAuthorization) return;

    await session.readyClearPort.clearReadyLedger(
      retryAuthorization,
    );
    expect(handle.writeCount).toBe(writesBeforeClear + 1);
  });

  it("rechecks the disk after clear encryption and preserves a late external revision", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger301 = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger301,
      {
        generateId: createIdGenerator([
          "file-clear-drift",
          "revision-301",
          "revision-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:02:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const serialized301 = handle.bytes.slice();
    const externalRepository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator(["revision-302"]),
        now: createClock(["2026-07-28T10:01:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const ledger302 = createLedgerWithTrades(2);
    await externalRepository.save(ledger302);
    const serialized302 = handle.bytes.slice();
    handle.bytes = serialized301;
    const writesBeforeClear = handle.writeCount;
    const session = createReadyClearSession(
      repository,
      "ready-clear-late-drift",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.mutateBeforeNthRead(2, () => {
      handle.bytes = serialized302;
    });

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeClear);
    expect(handle.bytes).toEqual(serialized302);
    await expect(externalRepository.load()).resolves.toEqual(
      ledger302,
    );
  });
});
