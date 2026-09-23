import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import { bytesToBase64Url } from "@/platform/encryption";
import type { LedgerData } from "@/core/models";
import { LedgerFileRepository } from "./ledgerFileRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
} from "./ledgerFileRepositoryContract";
import {
  readLedgerFileForTest,
  serializeLedgerFileForTest,
} from "@/test-support";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createTrade,
  createLedgerWithTrades,
  replaceLedgerFileSalt,
  replacePublishedLedgerFile,
  createSessionLease,
  reencryptCurrentWithSamePlaintext,
  readVerifiedFile,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it("rejects invalid and resource-violating candidates before opening a writable", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const original = handle.text();

    await expect(
      repository.save({
        ...ledger,
        schemaVersion: 1,
      } as unknown as LedgerData),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    await expect(
      repository.save({
        ...ledger,
        trades: [
          { ...ledger.trades[0], note: "x".repeat(4_097) },
          ...ledger.trades.slice(1),
        ],
      }),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    expect(handle.text()).toBe(original);
    expect(handle.writeCount).toBe(1);
  });

  it.each(["write", "close"] as const)(
    "does not publish %s failure as success and retries the same savedAt, revision, IV, and ciphertext",
    async (stage) => {
      const handle = new AtomicLedgerHandle();
      const ledger = createLedgerWithTrades(3);
      const generateId = createIdGenerator([
        "file-a",
        "revision-a",
        "revision-b",
      ]);
      const now = createClock([
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:01:00.000Z",
      ]);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger,
        { generateId, now, sessionLease: TEST_SESSION_LEASE },
      );
      const original = handle.text();
      const candidate = {
        ...ledger,
        trades: [...ledger.trades, createTrade(3)],
      };
      if (stage === "write") handle.failNextWrite = true;
      if (stage === "close") handle.failNextClose = true;

      await expect(repository.save(candidate)).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      });
      expect(handle.text()).toBe(original);

      await repository.save(candidate);
      const result = await readVerifiedFile(handle);
      expect(result.file.current.revisionId).toBe("revision-b");
      expect(result.current.savedAt).toBe("2026-07-28T10:01:00.000Z");
      expect(generateId).toHaveBeenCalledTimes(3);
      expect(now).toHaveBeenCalledTimes(2);
    },
    15_000,
  );

  it("confirms an already-written pending revision on retry without writing a new generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(3);
    const generateId = createIdGenerator([
      "file-a",
      "revision-a",
      "revision-b",
    ]);
    const now = createClock([
      "2026-07-28T10:00:00.000Z",
      "2026-07-28T10:01:00.000Z",
    ]);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      { generateId, now, sessionLease: TEST_SESSION_LEASE },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(3)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect(handle.writeCount).toBe(2);

    await repository.save(candidate);
    expect(handle.writeCount).toBe(2);
    const result = await readVerifiedFile(handle);
    expect(result.file.current.revisionId).toBe("revision-b");
    expect(result.current.ledgerData.trades).toHaveLength(4);
    expect(generateId).toHaveBeenCalledTimes(3);
  });

  it("rejects a create readback that was re-encrypted outside the exact write intent", async () => {
    const handle = new AtomicLedgerHandle();
    handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

    await expect(
      LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator(["file-a", "revision-a"]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease(
            "create-exact-generation",
          ),
        },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
      "revision-a",
    );
  });

  it("rejects a save readback that has the same payload but a different encrypted current generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: createSessionLease(
          "save-exact-generation",
        ),
      },
    );
    handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

    await expect(
      repository.save({
        ...ledger,
        trades: [...ledger.trades, createTrade(1)],
      }),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledger);
    expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
      "revision-b",
    );
  });

  it("rejects create when close-after-readback sees a valid but different on-disk salt", async () => {
    const handle = new AtomicLedgerHandle();
    handle.mutateAfterClose = (serialized) =>
      replaceLedgerFileSalt(serialized);

    await expect(
      LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator(["file-a", "revision-a"]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: TEST_SESSION_LEASE,
        },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });

    await expect(
      LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        { sessionLease: TEST_SESSION_LEASE },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });
  });

  it("rejects save salt drift without advancing the last verified ledger", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.mutateAfterClose = (serialized) =>
      replaceLedgerFileSalt(serialized);

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledger);

    const diskFile = readLedgerFileForTest(handle.text());
    expect(diskFile.current.revisionId).toBe("revision-b");
    expect(handle.writeCount).toBe(2);
  });

  it("rejects pending-intent reconcile salt drift, retains the intent, and creates no extra generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const committedBeforeDrift = handle.text();
    replacePublishedLedgerFile(
      handle,
      replaceLedgerFileSalt(committedBeforeDrift),
    );

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    await expect(repository.load()).resolves.toEqual(ledger);
    expect(handle.writeCount).toBe(2);
    expect(
      readLedgerFileForTest(handle.text()).current.revisionId,
    ).toBe("revision-b");

    replacePublishedLedgerFile(handle, committedBeforeDrift);
    await repository.save(candidate);
    expect(handle.writeCount).toBe(2);
    expect(
      (await readVerifiedFile(handle)).file.current.revisionId,
    ).toBe("revision-b");
  });

  it("classifies malformed external bytes during pending reconcile as an external change with zero writes", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: createSessionLease(
          "pending-malformed-external",
        ),
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const exactPendingIntent = handle.text();
    const writesBeforeExternalChange = handle.writeCount;
    replacePublishedLedgerFile(handle, "{");

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeExternalChange);
    expect(handle.text()).toBe("{");
    await expect(repository.load()).resolves.toEqual(ledger);

    replacePublishedLedgerFile(handle, exactPendingIntent);
    await repository.save(candidate);
    expect(handle.writeCount).toBe(writesBeforeExternalChange);
    await expect(repository.load()).resolves.toEqual(candidate);
  });

  it.each([
    [
      "fileId",
      (serialized: string) => {
        const file = readLedgerFileForTest(serialized);
        return serializeLedgerFileForTest({
          ...file,
          fileId: "different-file",
        });
      },
    ],
    [
      "revision chain",
      (serialized: string) => {
        const file = readLedgerFileForTest(serialized);
        return serializeLedgerFileForTest({
          ...file,
          current: {
            ...file.current,
            parentRevisionId: "unexpected-parent",
          },
        });
      },
    ],
    [
      "current authentication",
      (serialized: string) => {
        const file = readLedgerFileForTest(serialized);
        return serializeLedgerFileForTest({
          ...file,
          current: {
            ...file.current,
            ciphertextBase64Url: bytesToBase64Url(
              new Uint8Array(16).fill(4),
            ),
          },
        });
      },
    ],
    [
      "previous authentication",
      (serialized: string) => {
        const file = readLedgerFileForTest(serialized);
        return serializeLedgerFileForTest({
          ...file,
          previous: file.previous
            ? {
                ...file.previous,
                ciphertextBase64Url: bytesToBase64Url(
                  new Uint8Array(16).fill(5),
                ),
              }
            : null,
        });
      },
    ],
  ] as const)(
    "does not resolve when close-after-readback detects %s mismatch",
    async (_name, mutate) => {
      const handle = new AtomicLedgerHandle();
      const ledger = createLedgerWithTrades(3);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger,
        {
          generateId: createIdGenerator([
            "file-a",
            "revision-a",
            "revision-b",
          ]),
          now: createClock([
            "2026-07-28T10:00:00.000Z",
            "2026-07-28T10:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      handle.mutateAfterClose = mutate;

      await expect(
        repository.save({
          ...ledger,
          trades: [...ledger.trades, createTrade(3)],
        }),
      ).rejects.toBeDefined();
      await expect(repository.load()).resolves.toEqual(ledger);
    },
    15_000,
  );

  it("binds by fileId rather than filename and preserves a byte-copy identity", async () => {
    const first = new AtomicLedgerHandle("same-name.lftl");
    const second = new AtomicLedgerHandle("same-name.lftl");
    await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      first,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      second,
      PASSPHRASE,
      createLedgerWithTrades(2),
      {
        generateId: createIdGenerator(["file-b", "revision-b"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    expect((await readVerifiedFile(first)).file.fileId).toBe("file-a");
    expect((await readVerifiedFile(second)).file.fileId).toBe("file-b");

    const copy = new AtomicLedgerHandle("renamed-copy.lftl");
    copy.bytes = first.bytes.slice();
    const opened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      copy,
      PASSPHRASE,
      {
        expectedFileId: "file-a",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(opened.load()).resolves.toEqual(createLedgerWithTrades(1));
    expect((await readVerifiedFile(copy)).file.fileId).toBe("file-a");
  });
});
