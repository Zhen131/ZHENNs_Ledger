import { describe, expect, it, vi } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import type { CryptoProvider } from "@/platform/encryption";
import { createInitialLedgerData } from "@/core/state";
import { LedgerFileRepository } from "./ledgerFileRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
} from "./ledgerFileRepositoryContract";
import {
  appendLedgerFileJsonWhitespaceForTest,
  ledgerFileTestStringToBytes,
  readLedgerFileJsonHeaderForTest,
} from "@/test-support";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  createReadyImportSession,
  createImportEvidence,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createLedgerWithTrades,
  createDeferred,
  GatedSessionLease,
  readVerifiedFile,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it(
    "imports one exact 300-trade B into a new empty C and reopens the verified two-generation file",
    async () => {
      const handle = new AtomicLedgerHandle("import-300.lftl");
      const initialLedger = createInitialLedgerData();
      const candidate = createLedgerWithTrades(300);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        initialLedger,
        {
          generateId: createIdGenerator([
            "file-import-300",
            "revision-empty",
            "revision-import-300",
          ]),
          now: createClock([
            "2026-07-31T08:00:00.000Z",
            "2026-07-31T08:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const before = await readVerifiedFile(handle);
      const session = createReadyImportSession(
        repository,
        "import-300-session",
      );
      const evidence = await createImportEvidence(candidate);
      const authorization =
        session.readyImportPort?.authorizeReadyImport(
          evidence,
          0,
          evidence.candidateIdentity,
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyImportPort) return;

      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).resolves.toEqual(candidate);

      const after = await readVerifiedFile(handle);
      expect(after.current.ledgerData).toEqual(candidate);
      expect(after.current.ledgerData.trades).toHaveLength(300);
      expect(after.previous?.ledgerData).toEqual(initialLedger);
      expect(after.file.previous).toEqual(before.file.current);
      expect(after.file.current.parentRevisionId).toBe(
        "revision-empty",
      );
      expect(after.file.current.revisionId).toBe(
        "revision-import-300",
      );
      expect(handle.writeCount).toBe(2);

      const reopened = await LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          expectedFileId: "file-import-300",
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      await expect(reopened.load()).resolves.toEqual(candidate);
    },
    20_000,
  );

  it.each([
    "create-writable",
    "write",
    "close",
    "readback",
  ] as const)(
    "restores and fully verifies the exact pre-import C after a %s failure",
    async (failure) => {
      const handle = new AtomicLedgerHandle(
        `import-${failure}.lftl`,
      );
      const initialLedger = createInitialLedgerData();
      const candidate = createLedgerWithTrades(3);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        initialLedger,
        {
          generateId: createIdGenerator([
            `file-import-${failure}`,
            "revision-empty",
            `revision-import-${failure}`,
          ]),
          now: createClock([
            "2026-07-31T08:00:00.000Z",
            "2026-07-31T08:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const baseline = handle.text();
      const before = await readVerifiedFile(handle);
      const session = createReadyImportSession(
        repository,
        `import-${failure}-session`,
      );
      const evidence = await createImportEvidence(candidate);
      const authorization =
        session.readyImportPort?.authorizeReadyImport(
          evidence,
          0,
          evidence.candidateIdentity,
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyImportPort) return;
      if (failure === "create-writable") {
        handle.failNextCreateWritable = true;
      }
      if (failure === "write") handle.failNextWrite = true;
      if (failure === "close") handle.failNextClose = true;
      if (failure === "readback") {
        handle.failReadAfterClose = true;
      }

      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code:
          LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
      });

      expect(handle.text()).toBe(baseline);
      expect(handle.bytes).toEqual(
        ledgerFileTestStringToBytes(baseline),
      );
      const after = await readVerifiedFile(handle);
      expect(after.file).toEqual(before.file);
      expect(after.current).toEqual(before.current);
      expect(after.previous).toEqual(before.previous);
      await expect(repository.load()).resolves.toEqual(initialLedger);
      const writesAfterFailure = handle.writeCount;
      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code:
          LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
      });
      expect(handle.writeCount).toBe(writesAfterFailure);
    },
    20_000,
  );

  it("restores and exactly re-reads the old C when close publishes the candidate and then throws", async () => {
    const handle = new AtomicLedgerHandle(
      "import-close-published-then-failed.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-close-published-then-failed",
          "revision-empty",
          "revision-import-close-published-then-failed",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baselineBytes = handle.bytes.slice();
    const before = await readVerifiedFile(handle);
    const session = createReadyImportSession(
      repository,
      "import-close-published-then-failed-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const writesBeforeImport = handle.writeCount;
    handle.failAfterNextClosePublish = true;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });

    expect(handle.writeCount).toBe(writesBeforeImport + 2);
    expect(handle.bytes).toEqual(baselineBytes);
    const after = await readVerifiedFile(handle);
    expect(after.file).toEqual(before.file);
    expect(after.current).toEqual(before.current);
    expect(after.previous).toEqual(before.previous);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId:
          "file-import-close-published-then-failed",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(initialLedger);
  });

  it("restores and exactly re-reads the old C when cancellation arrives during candidate readback", async () => {
    const handle = new AtomicLedgerHandle(
      "import-cancel-during-readback.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-cancel-during-readback",
          "revision-empty",
          "revision-import-cancel-during-readback",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baselineBytes = handle.bytes.slice();
    const before = await readVerifiedFile(handle);
    const readbackStarted = createDeferred<void>();
    const releaseReadback = createDeferred<void>();
    handle.blockReadAfterNextClose = {
      started: readbackStarted,
      release: releaseReadback,
    };
    const session = createReadyImportSession(
      repository,
      "import-cancel-during-readback-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const controller = new AbortController();
    const writesBeforeImport = handle.writeCount;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        controller.signal,
      );
    await readbackStarted.promise;
    expect(handle.bytes).not.toEqual(baselineBytes);
    controller.abort("cancelled during candidate readback");
    releaseReadback.resolve();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });
    expect(handle.writeCount).toBe(writesBeforeImport + 2);
    expect(handle.bytes).toEqual(baselineBytes);
    const after = await readVerifiedFile(handle);
    expect(after.file).toEqual(before.file);
    expect(after.current).toEqual(before.current);
    expect(after.previous).toEqual(before.previous);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId: "file-import-cancel-during-readback",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(initialLedger);
  });

  it("marks the session recovery-blocked when neither compensation nor final read can prove the old bytes", async () => {
    const handle = new AtomicLedgerHandle("import-blocked.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-blocked",
          "revision-empty",
          "revision-import-blocked",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const session = createReadyImportSession(
      repository,
      "import-blocked-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateAfterClose = (serialized) => {
      handle.failNextRead = true;
      handle.failNextWrite = true;
      return serialized;
    };

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).not.toBe(baseline);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
    const writesAfterBlocked = handle.writeCount;
    await expect(repository.save(candidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesAfterBlocked);
  });

  it("blocks the session when the exact base bytes are present but cannot be fully authenticated during recovery", async () => {
    const decrypt = vi.fn(
      globalThis.crypto.subtle.decrypt.bind(
        globalThis.crypto.subtle,
      ),
    );
    const cryptoProvider = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
      subtle: {
        importKey: globalThis.crypto.subtle.importKey.bind(
          globalThis.crypto.subtle,
        ),
        deriveKey: globalThis.crypto.subtle.deriveKey.bind(
          globalThis.crypto.subtle,
        ),
        encrypt: globalThis.crypto.subtle.encrypt.bind(
          globalThis.crypto.subtle,
        ),
        decrypt,
      },
    } as unknown as CryptoProvider;
    const handle = new AtomicLedgerHandle(
      "import-base-verification-blocked.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        cryptoProvider,
        generateId: createIdGenerator([
          "file-import-base-verification-blocked",
          "revision-empty",
          "revision-import-blocked",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const nativeDecrypt =
      globalThis.crypto.subtle.decrypt.bind(
        globalThis.crypto.subtle,
      );
    decrypt
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockRejectedValueOnce(
        new Error("recovery authentication unavailable"),
      );
    const baseline = handle.text();
    const session = createReadyImportSession(
      repository,
      "import-base-verification-blocked-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.failNextWrite = true;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).toBe(baseline);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
    const writesAfterBlocked = handle.writeCount;
    await expect(repository.save(candidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesAfterBlocked);
  });

  it("does not compensate over valid but non-exact candidate readback bytes", async () => {
    const handle = new AtomicLedgerHandle(
      "import-non-exact-readback.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-non-exact-readback",
          "revision-empty",
          "revision-import-non-exact",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const writesBeforeImport = handle.writeCount;
    const session = createReadyImportSession(
      repository,
      "import-non-exact-readback-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateAfterClose = appendLedgerFileJsonWhitespaceForTest;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).not.toBe(baseline);
    expect(
      readLedgerFileJsonHeaderForTest(handle.bytes).endsWith("\n"),
    ).toBe(true);
    expect(handle.writeCount).toBe(writesBeforeImport + 1);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
  });

  it("revokes an import queued before its write-lock claim when the session quiesces", async () => {
    const lease = new GatedSessionLease();
    const handle = new AtomicLedgerHandle("import-queued.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-queued",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock(["2026-07-31T08:00:00.000Z"]),
        sessionLease: lease,
      },
    );
    const writesBeforeImport = handle.writeCount;
    const session = createReadyImportSession(
      repository,
      "import-queued-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const gate = lease.gateNextOperation();

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await gate.started;
    session.beginQuiesce("immediate-lock");
    gate.release();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.closeCount).toBe(writesBeforeImport);
  });

  it("rejects a generic save admitted while import owns the write slot, then allows saves after a verified import completes", async () => {
    const lease = new GatedSessionLease();
    const handle = new AtomicLedgerHandle(
      "import-save-admission.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const laterCandidate = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-save-admission",
          "revision-empty",
          "revision-import",
          "revision-later-save",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
          "2026-07-31T08:02:00.000Z",
        ]),
        sessionLease: lease,
      },
    );
    const session = createReadyImportSession(
      repository,
      "import-save-admission-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const gate = lease.gateNextOperation();
    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await gate.started;
    const operationCountDuringImport = lease.operationCount;

    await expect(repository.save(laterCandidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(lease.operationCount).toBe(operationCountDuringImport);

    gate.release();
    await expect(importPromise).resolves.toEqual(candidate);
    await expect(repository.save(laterCandidate)).resolves.toBeUndefined();
    await expect(repository.load()).resolves.toEqual(laterCandidate);
    expect(handle.writeCount).toBe(3);
  });

  it("restores the old C when quiesce starts after the candidate close has begun", async () => {
    const handle = new AtomicLedgerHandle("import-active.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-active",
          "revision-empty",
          "revision-import-active",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const closeStarted = createDeferred<void>();
    const releaseClose = createDeferred<void>();
    handle.mutateAfterClose = async (serialized) => {
      closeStarted.resolve();
      await releaseClose.promise;
      return serialized;
    };
    const session = createReadyImportSession(
      repository,
      "import-active-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await closeStarted.promise;
    session.beginQuiesce("immediate-lock");
    releaseClose.resolve();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });
    expect(handle.text()).toBe(baseline);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects non-empty C targets and unconfirmed or hard-error evidence before writable creation", async () => {
    const handle = new AtomicLedgerHandle("import-rejected.lftl");
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-rejected",
          "revision-empty",
          "revision-non-empty",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = createLedgerWithTrades(2);
    const session = createReadyImportSession(
      repository,
      "import-rejected-session",
    );
    const hardErrorEvidence = await createImportEvidence(candidate, {
      hardErrorCount: 1,
    });
    expect(
      session.readyImportPort?.authorizeReadyImport(
        hardErrorEvidence,
        0,
        hardErrorEvidence.candidateIdentity,
      ),
    ).toBeNull();
    const unconfirmedEvidence = await createImportEvidence(
      candidate,
      {
        suspiciousGroupCount: 1,
        suspiciousGroupIdentity: "groups-a",
      },
    );
    expect(
      session.readyImportPort?.authorizeReadyImport(
        unconfirmedEvidence,
        0,
        unconfirmedEvidence.candidateIdentity,
      ),
    ).toBeNull();
    expect(handle.writeCount).toBe(1);

    await repository.save(createLedgerWithTrades(1));
    const writesAfterSave = handle.writeCount;
    const nonEmptyEvidence = await createImportEvidence(candidate);
    expect(
      session.readyImportPort?.authorizeReadyImport(
        nonEmptyEvidence,
        0,
        nonEmptyEvidence.candidateIdentity,
      ),
    ).toBeNull();
    expect(handle.writeCount).toBe(writesAfterSave);
  });

  it("rejects a structurally valid candidate with forged zero-error evidence when historical rawText is missing", async () => {
    const handle = new AtomicLedgerHandle(
      "import-missing-raw-text.lftl",
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-missing-raw-text",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock(["2026-07-31T08:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = createLedgerWithTrades(2);
    delete candidate.trades[1].rawText;
    const evidence = await createImportEvidence(candidate);
    const session = createReadyImportSession(
      repository,
      "import-missing-raw-text-session",
    );
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    const writesBeforeImport = handle.writeCount;
    expect(authorization).toBeNull();
    expect(handle.writeCount).toBe(writesBeforeImport);
  });

  it("re-reads after import encryption and preserves a late external revision with zero import writes", async () => {
    const handle = new AtomicLedgerHandle(
      "import-late-external.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-late-external",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:02:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.bytes.slice();
    const externalRepository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator([
          "revision-external",
        ]),
        now: createClock([
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const externalLedger = createLedgerWithTrades(1);
    await externalRepository.save(externalLedger);
    const externalBytes = handle.bytes.slice();
    handle.bytes = baseline;
    const writesBeforeImport = handle.writeCount;
    const candidate = createLedgerWithTrades(2);
    const session = createReadyImportSession(
      repository,
      "import-late-external-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateBeforeNthRead(2, () => {
      handle.bytes = externalBytes;
    });

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.bytes).toEqual(externalBytes);
    await expect(externalRepository.load()).resolves.toEqual(
      externalLedger,
    );
  });
});
