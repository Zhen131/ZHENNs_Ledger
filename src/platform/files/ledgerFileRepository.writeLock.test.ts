import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import type { LedgerData } from "@/core/models";
import { LedgerFileRepository } from "./ledgerFileRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
} from "./ledgerFileRepositoryContract";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createTrade,
  createLedgerWithTrades,
  replacePublishedLedgerFile,
  createSessionLease,
  GatedSessionLease,
  corruptCurrentCiphertext,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it("treats the same canonical ledger as a no-op without new time, revision, IV, or write", async () => {
    const handle = new AtomicLedgerHandle();
    const generateId = createIdGenerator(["file-a", "revision-a"]);
    const now = createClock(["2026-07-28T10:00:00.000Z"]);
    const ledger = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      { generateId, now, sessionLease: TEST_SESSION_LEASE },
    );
    const original = handle.text();

    await repository.save(structuredClone(ledger));

    expect(handle.text()).toBe(original);
    expect(handle.writeCount).toBe(1);
    expect(generateId).toHaveBeenCalledTimes(2);
    expect(now).toHaveBeenCalledOnce();
  });

  it("keeps ordinary save re-read, write, close, and readback inside the session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger = createLedgerWithTrades(1);
    const sessionLease = createSessionLease(
      "ordinary-save-order",
      events,
    );
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
        sessionLease,
      },
    );
    events.length = 0;

    await repository.save({
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    });

    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);
  });

  it("drops an older valid save candidate that is still waiting for the write lock", async () => {
    const handle = new AtomicLedgerHandle();
    const sessionLease = new GatedSessionLease();
    const ledgerA = createLedgerWithTrades(1);
    const ledgerB = {
      ...ledgerA,
      trades: [...ledgerA.trades, createTrade(1)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease,
      },
    );
    const serializedA = handle.text();
    const gate = sessionLease.gateNextOperation();

    const obsoleteSave = repository.save(ledgerB);
    await gate.started;
    const latestSave = repository.save(structuredClone(ledgerA));
    expect(sessionLease.operationCount).toBe(3);
    gate.release();
    await Promise.all([obsoleteSave, latestSave]);

    expect(handle.writeCount).toBe(1);
    expect(handle.text()).toBe(serializedA);
    await expect(repository.load()).resolves.toEqual(ledgerA);
  });

  it("does not let an invalid newer request cancel the latest legal candidate waiting for the write lock", async () => {
    const handle = new AtomicLedgerHandle();
    const sessionLease = new GatedSessionLease();
    const ledgerA = createLedgerWithTrades(1);
    const ledgerB = {
      ...ledgerA,
      trades: [...ledgerA.trades, createTrade(1)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
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
        sessionLease,
      },
    );
    const gate = sessionLease.gateNextOperation();

    const legalSave = repository.save(ledgerB);
    await gate.started;
    await expect(
      repository.save({
        ...ledgerA,
        schemaVersion: 1,
      } as unknown as LedgerData),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    expect(sessionLease.operationCount).toBe(2);
    gate.release();
    await legalSave;

    expect(handle.writeCount).toBe(2);
    await expect(repository.load()).resolves.toEqual(ledgerB);
  });

  it("keeps a pending-intent write and its no-write reconcile inside the same session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger = createLedgerWithTrades(1);
    const sessionLease = createSessionLease(
      "pending-order",
      events,
    );
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
        sessionLease,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    events.length = 0;
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);

    events.length = 0;
    await repository.save(candidate);
    expect(events).toEqual([
      "lock-enter",
      "read",
      "lock-exit",
    ]);
  });

  it("keeps recovery re-read, write, close, and readback inside the retained session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger301 = createLedgerWithTrades(1);
    const ledger302 = {
      ...ledger301,
      trades: [...ledger301.trades, createTrade(1)],
    };
    const sessionLease = createSessionLease(
      "recovery-order",
      events,
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger301,
      {
        generateId: createIdGenerator([
          "file-recovery-order",
          "revision-301",
          "revision-302",
          "revision-recovered",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
          "2026-07-28T10:02:00.000Z",
        ]),
        sessionLease,
      },
    );
    await repository.save(ledger302);
    replacePublishedLedgerFile(
      handle,
      corruptCurrentCiphertext(handle.text()),
    );
    const opened = await LedgerFileRepository.openForAccess(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId: "file-recovery-order",
        generateId: createIdGenerator(["revision-recovered"]),
        now: createClock(["2026-07-28T10:02:00.000Z"]),
        sessionLease,
      },
    );
    expect(opened.status).toBe("recovery-required");
    if (opened.status !== "recovery-required") return;
    events.length = 0;

    await opened.candidate.confirm();

    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);
  });
});
