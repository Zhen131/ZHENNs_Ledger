import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import { LedgerFileRepository } from "./ledgerFileRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
} from "./ledgerFileRepositoryContract";
import { ledgerFileBodySlotOffsetV3S2 } from "./ledgerFileSlotContainerV3";
import {
  ledgerFileBodySlotOffsetV3S3,
  ledgerFileHeaderSlotOffsetV3S3,
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
} from "./ledgerFileChunkedContainerV3";
import { readLedgerFileSlotViewForTest } from "@/test-support";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createTrade,
  createLedgerWithTrades,
  readVerifiedFile,
  readLatestChunkedFile,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it("recovers the exact previous ledger after the current whole-ledger slot is corrupted", async () => {
    const handle = new AtomicLedgerHandle();
    const ledgerBefore = createLedgerWithTrades(4);
    const ledgerAfter = {
      ...ledgerBefore,
      trades: [...ledgerBefore.trades, createTrade(4)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerBefore,
      {
        generateId: createIdGenerator([
          "file-s2-recovery",
          "revision-s2-before",
          "revision-s2-damaged",
        ]),
        now: createClock([
          "2026-09-01T09:00:00.000Z",
          "2026-09-01T09:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await repository.save(ledgerAfter);
    const beforeDamage = readLedgerFileSlotViewForTest(handle.bytes);
    expect(beforeDamage.ok).toBe(true);
    if (!beforeDamage.ok) return;
    const currentOffset = ledgerFileBodySlotOffsetV3S2(
      beforeDamage.value.bodySlotBytes,
      beforeDamage.value.current.bodySlot,
    );
    handle.bytes[currentOffset] ^= 0xff;

    const opened = await LedgerFileRepository.openForAccess(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator(["revision-s2-recovered"]),
        now: createClock(["2026-09-01T09:02:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    expect(opened.status).toBe("recovery-required");
    if (opened.status !== "recovery-required") return;
    const recovered = await opened.candidate.confirm();

    await expect(recovered.load()).resolves.toEqual(ledgerBefore);
    const verified = await readVerifiedFile(handle);
    expect(verified.current.ledgerData).toEqual(ledgerBefore);
    expect(verified.previous?.ledgerData).toEqual(ledgerBefore);
  });

  it(
    "recovers every field from the previous chunked generation when one current fact block is corrupted",
    async () => {
      const handle = new AtomicLedgerHandle("chunk-recovery.lftl");
      const ledgerBefore = createLedgerWithTrades(4_001);
      const ledgerAfter = structuredClone(ledgerBefore);
      ledgerAfter.trades[17] = {
        ...ledgerAfter.trades[17]!,
        note: "随后会被破坏的虚构当前块",
        updatedAt: "2026-09-01T11:31:00.000Z",
      };
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledgerBefore,
        {
          generateId: createIdGenerator([
            "file-chunk-recovery",
            "revision-chunk-recovery-before",
            "revision-chunk-recovery-damaged",
            "revision-chunk-recovery-confirmed",
          ]),
          now: createClock([
            "2026-09-01T11:30:00.000Z",
            "2026-09-01T11:31:00.000Z",
            "2026-09-01T11:32:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      await repository.save(ledgerAfter);
      const damaged = readLatestChunkedFile(handle);
      const currentTarget = damaged.current.factBlocks[0]!;
      handle.bytes[ledgerFileBodySlotOffsetV3S3(currentTarget.bodySlots[0]!)]
        ^= 0xff;

      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator([
            "revision-chunk-recovery-confirmed",
          ]),
          now: createClock(["2026-09-01T11:32:00.000Z"]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      const recovered = await opened.candidate.confirm();

      await expect(recovered.load()).resolves.toEqual(ledgerBefore);
      const verified = await readVerifiedFile(handle);
      expect(verified.current.ledgerData).toEqual(ledgerBefore);
      expect(verified.previous?.ledgerData).toEqual(ledgerBefore);
    },
    20_000,
  );

  it("offers explicit recovery from the older header when the latest manifest is corrupted", async () => {
    const handle = new AtomicLedgerHandle("chunk-manifest-recovery.lftl");
    const ledgerBefore = createLedgerWithTrades(3);
    const ledgerAfter = {
      ...ledgerBefore,
      trades: [...ledgerBefore.trades, createTrade(3)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerBefore,
      {
        generateId: createIdGenerator([
          "file-chunk-manifest-recovery",
          "revision-chunk-manifest-before",
          "revision-chunk-manifest-damaged",
        ]),
        now: createClock([
          "2026-09-01T11:40:00.000Z",
          "2026-09-01T11:41:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await repository.save(ledgerAfter);
    const latest = readLatestChunkedFile(handle);
    const manifestTagLastByte =
      ledgerFileHeaderSlotOffsetV3S3(latest.activeHeaderSlot) +
      LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES -
      1;
    handle.bytes[manifestTagLastByte] ^= 0xff;

    const opened = await LedgerFileRepository.openForAccess(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator([
          "revision-chunk-manifest-recovered",
        ]),
        now: createClock(["2026-09-01T11:42:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    expect(opened.status).toBe("recovery-required");
    if (opened.status !== "recovery-required") return;
    const recovered = await opened.candidate.confirm();

    await expect(recovered.load()).resolves.toEqual(ledgerBefore);
  });

  it("keeps the prior header usable and stops blind retries when the new header write is interrupted", async () => {
    const handle = new AtomicLedgerHandle();
    const ledgerBefore = createLedgerWithTrades(2);
    const ledgerAfter = {
      ...ledgerBefore,
      trades: [...ledgerBefore.trades, createTrade(2)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerBefore,
      {
        generateId: createIdGenerator([
          "file-s2-interrupted-header",
          "revision-s2-stable",
          "revision-s2-uncommitted",
        ]),
        now: createClock([
          "2026-09-01T10:00:00.000Z",
          "2026-09-01T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    handle.publishBeforeFailingPositionedWrite = 2;

    await expect(repository.save(ledgerAfter)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledgerBefore);
    const writesAfterInterruption = handle.writeCount;
    await expect(repository.save(ledgerAfter)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesAfterInterruption);

    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator(["unused-recovery-id"]),
        now: createClock(["2026-09-01T10:02:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(ledgerBefore);
  });
});
