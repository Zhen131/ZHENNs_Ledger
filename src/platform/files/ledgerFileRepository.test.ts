import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import { createInitialLedgerData, ledgerReducer } from "@/core/state";
import { LedgerFileRepository } from "./ledgerFileRepository";
import { LEDGER_FILE_REPOSITORY_ERROR_CODES } from "./ledgerFileRepositoryContract";
import {
  ledgerFileBodySlotOffsetV3S2,
} from "./ledgerFileSlotContainerV3";
import {
  parseLedgerFileV3S3Candidates,
} from "./ledgerFileChunkedContainerV3Parse";
import {
  readLedgerFileBodySlotForTest,
  readLedgerFileSlotViewForTest,
} from "@/test-support";
import {
  PASSPHRASE,
  TEST_SESSION_LEASE,
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createTrade,
  createLedgerWithTrades,
  createLedgerWithCashEvents,
  readVerifiedFile,
  readLatestChunkedFile,
  readChunkedBodySlots,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it("round-trips a mapping-null fictional asset with multi-day manual prices through C", async () => {
    const handle = new AtomicLedgerHandle("manual-prices.lftl");
    const ledger = createInitialLedgerData();
    ledger.assets.push({
      id: "asset-knight-c-roundtrip",
      symbol: "KNIGHT",
      name: "KNIGHT",
      quoteCurrency: "USDT",
      binanceMapping: null,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z",
    });
    ledger.trades.push({
      id: "trade-knight-c-roundtrip",
      occurredAt: "2026-08-10",
      timePrecision: "day",
      type: "buy",
      assetSymbol: "KNIGHT",
      quantity: "2",
      price: "5",
      totalValue: "10",
      currency: "USDT",
      fee: "0",
      feeCurrency: "USDT",
      createdAt: "2026-08-10T08:01:00.000Z",
      updatedAt: "2026-08-10T08:01:00.000Z",
    });
    ledger.priceSnapshots.push(
      {
        id: "price-knight-c-day-1",
        assetSymbol: "KNIGHT",
        price: "10",
        currency: "USDT",
        recordedAt: "2026-08-11",
        source: "manual",
        createdAt: "2026-08-11T08:00:00.000Z",
        updatedAt: "2026-08-11T08:00:00.000Z",
      },
      {
        id: "price-knight-c-day-2",
        assetSymbol: "KNIGHT",
        price: "20",
        currency: "USDT",
        recordedAt: "2026-08-12",
        source: "manual",
        createdAt: "2026-08-12T08:00:00.000Z",
        updatedAt: "2026-08-12T08:00:00.000Z",
      },
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-manual-prices",
          "revision-manual-prices",
        ]),
        now: createClock(["2026-08-19T13:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    const loaded = await repository.load();
    expect(
      loaded.assets.find(({ symbol }) => symbol === "KNIGHT")?.binanceMapping,
    ).toBeNull();
    expect(
      loaded.priceSnapshots.filter(
        ({ assetSymbol }) => assetSymbol === "KNIGHT",
      ),
    ).toEqual(ledger.priceSnapshots);
  });

  it.each([
    { name: "empty", count: 0, blockCounts: [] },
    { name: "single", count: 1, blockCounts: [1] },
    { name: "under one full block", count: 1_999, blockCounts: [1_999] },
    { name: "exactly one full block", count: 2_000, blockCounts: [2_000] },
    { name: "across multiple blocks", count: 2_001, blockCounts: [2_000, 1] },
  ])(
    "round-trips every field for the Q-2 $name ledger",
    async ({ name, count, blockCounts }) => {
      const handle = new AtomicLedgerHandle(`q2-${name}.lftl`);
      const ledger = createLedgerWithCashEvents(count);
      await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger,
        {
          generateId: createIdGenerator([
            `file-q2-${name}`,
            `revision-q2-${name}`,
          ]),
          now: createClock(["2026-09-01T11:00:00.000Z"]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const physical = readLatestChunkedFile(handle);
      const reopened = await LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          expectedFileId: `file-q2-${name}`,
          sessionLease: TEST_SESSION_LEASE,
        },
      );

      expect(
        physical.current.factBlocks.map(({ recordCount }) => recordCount),
      ).toEqual(blockCounts);
      await expect(reopened.load()).resolves.toEqual(ledger);
    },
    15_000,
  );

  it("persists an authoritative trade action by rewriting only its open fact block", async () => {
    const handle = new AtomicLedgerHandle("action-append.lftl");
    const ledger = createLedgerWithTrades(2_001);
    const appended = createTrade(2_001);
    const action = { type: "trade/add" as const, trade: appended };
    const expected = ledgerReducer(ledger, action);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-action-append",
          "revision-action-base",
          "revision-action-next",
        ]),
        now: createClock([
          "2026-09-01T11:05:00.000Z",
          "2026-09-01T11:06:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const before = readLatestChunkedFile(handle);
    const beforeBytes = Uint8Array.from(handle.bytes);

    await repository.saveAfterAction(action);

    const after = readLatestChunkedFile(handle);
    expect(after.current.factBlocks).toHaveLength(2);
    expect(after.current.factBlocks[0]).toEqual(before.current.factBlocks[0]);
    expect(
      readChunkedBodySlots(
        handle.bytes,
        after.current.factBlocks[0]!.bodySlots,
      ),
    ).toEqual(
      readChunkedBodySlots(
        beforeBytes,
        before.current.factBlocks[0]!.bodySlots,
      ),
    );
    expect(after.current.factBlocks[1]!.ivBase64Url).not.toBe(
      before.current.factBlocks[1]!.ivBase64Url,
    );
    await expect(repository.load()).resolves.toEqual(expected);
  }, 15_000);

  it("blocks later action saves after an uncertain action write until a full snapshot retry succeeds", async () => {
    const handle = new AtomicLedgerHandle("action-failure-chain.lftl");
    const ledger = createLedgerWithTrades(1);
    const firstAction = {
      type: "trade/add" as const,
      trade: createTrade(1),
    };
    const secondAction = {
      type: "trade/add" as const,
      trade: createTrade(2),
    };
    const afterFirst = ledgerReducer(ledger, firstAction);
    const afterSecond = ledgerReducer(afterFirst, secondAction);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-action-chain",
          "revision-action-chain-base",
          "revision-action-chain-first",
          "revision-action-chain-second",
        ]),
        now: createClock([
          "2026-09-01T11:07:00.000Z",
          "2026-09-01T11:08:00.000Z",
          "2026-09-01T11:09:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    handle.failNextWrite = true;

    await expect(repository.saveAfterAction(firstAction)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });
    await expect(repository.saveAfterAction(secondAction)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledger);

    await repository.save(afterFirst);
    await repository.saveAfterAction(secondAction);
    await expect(repository.load()).resolves.toEqual(afterSecond);
  }, 15_000);

  it(
    "rewrites only the control block and one edited historical fact block",
    async () => {
      const handle = new AtomicLedgerHandle("chunk-local-edit.lftl");
      const beforeLedger = createLedgerWithTrades(4_001);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        beforeLedger,
        {
          generateId: createIdGenerator([
            "file-chunk-local-edit",
            "revision-chunk-local-before",
            "revision-chunk-local-after",
          ]),
          now: createClock([
            "2026-09-01T11:10:00.000Z",
            "2026-09-01T11:11:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const beforeFile = readLatestChunkedFile(handle);
      const beforeBytes = Uint8Array.from(handle.bytes);
      const writesBefore = handle.writeOperations.length;
      const editedLedger = structuredClone(beforeLedger);
      editedLedger.trades[17] = {
        ...editedLedger.trades[17]!,
        note: "只编辑第一个历史块的虚构备注",
        updatedAt: "2026-09-01T11:11:00.000Z",
      };

      await repository.save(editedLedger);

      const afterFile = readLatestChunkedFile(handle);
      expect(afterFile.previous).toEqual(beforeFile.current);
      expect(afterFile.current.factBlocks).toHaveLength(3);
      expect(afterFile.current.controlBlock.ivBase64Url).not.toBe(
        beforeFile.current.controlBlock.ivBase64Url,
      );
      expect(afterFile.current.factBlocks[0]!.ivBase64Url).not.toBe(
        beforeFile.current.factBlocks[0]!.ivBase64Url,
      );
      for (const index of [1, 2]) {
        expect(afterFile.current.factBlocks[index]).toEqual(
          beforeFile.current.factBlocks[index],
        );
        expect(
          readChunkedBodySlots(
            handle.bytes,
            afterFile.current.factBlocks[index]!.bodySlots,
          ),
        ).toEqual(
          readChunkedBodySlots(
            beforeBytes,
            beforeFile.current.factBlocks[index]!.bodySlots,
          ),
        );
      }
      expect(handle.writeOperations.slice(writesBefore)).toHaveLength(2);
      await expect(repository.load()).resolves.toEqual(editedLedger);
    },
    20_000,
  );

  it(
    "keeps a deleted sealed block sparse and rewrites no unrelated fact block",
    async () => {
      const handle = new AtomicLedgerHandle("chunk-sparse-delete.lftl");
      const beforeLedger = createLedgerWithTrades(2_001);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        beforeLedger,
        {
          generateId: createIdGenerator([
            "file-chunk-sparse-delete",
            "revision-chunk-sparse-before",
            "revision-chunk-sparse-after",
          ]),
          now: createClock([
            "2026-09-01T11:15:00.000Z",
            "2026-09-01T11:16:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const beforeFile = readLatestChunkedFile(handle);
      const beforeBytes = Uint8Array.from(handle.bytes);
      const afterLedger = {
        ...beforeLedger,
        trades: beforeLedger.trades.filter(
          ({ id }) => id !== "fixture-trade-17",
        ),
      };

      await repository.save(afterLedger);

      const afterFile = readLatestChunkedFile(handle);
      expect(afterFile.current.factBlocks[0]).toMatchObject({
        sealed: true,
        recordCount: 1_999,
      });
      expect(afterFile.current.factBlocks[0]!.ivBase64Url).not.toBe(
        beforeFile.current.factBlocks[0]!.ivBase64Url,
      );
      expect(afterFile.current.factBlocks[1]).toEqual(
        beforeFile.current.factBlocks[1],
      );
      expect(
        readChunkedBodySlots(
          handle.bytes,
          afterFile.current.factBlocks[1]!.bodySlots,
        ),
      ).toEqual(
        readChunkedBodySlots(
          beforeBytes,
          beforeFile.current.factBlocks[1]!.bodySlots,
        ),
      );
      await expect(repository.load()).resolves.toEqual(afterLedger);
    },
    15_000,
  );

  it(
    "uses a fresh IV for every rewritten block and every reachable manifest",
    async () => {
      const handle = new AtomicLedgerHandle("chunk-iv-uniqueness.lftl");
      const beforeLedger = createLedgerWithTrades(2_001);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        beforeLedger,
        {
          generateId: createIdGenerator([
            "file-chunk-iv",
            "revision-chunk-iv-before",
            "revision-chunk-iv-after",
          ]),
          now: createClock([
            "2026-09-01T11:20:00.000Z",
            "2026-09-01T11:21:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const before = readLatestChunkedFile(handle);
      const edited = structuredClone(beforeLedger);
      edited.trades[0] = {
        ...edited.trades[0]!,
        note: "IV 不重用的虚构编辑",
        updatedAt: "2026-09-01T11:21:00.000Z",
      };

      await repository.save(edited);

      const parsed = parseLedgerFileV3S3Candidates(handle.bytes);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const latest = [...parsed.value.candidates].sort(
        (left, right) => right.file.sequence - left.file.sequence,
      )[0]!.file;
      expect(latest.previous).not.toBeNull();
      if (!latest.previous) return;
      expect(latest.current.controlBlock.ivBase64Url).not.toBe(
        before.current.controlBlock.ivBase64Url,
      );
      expect(latest.current.factBlocks[0]!.ivBase64Url).not.toBe(
        before.current.factBlocks[0]!.ivBase64Url,
      );
      expect(latest.current.factBlocks[1]).toEqual(
        before.current.factBlocks[1],
      );
      const currentById = new Map(
        [latest.current.controlBlock, ...latest.current.factBlocks].map(
          (block) => [block.blockId, block],
        ),
      );
      const previousChanged = [
        latest.previous.controlBlock,
        ...latest.previous.factBlocks,
      ].filter((block) => {
        const current = currentById.get(block.blockId);
        return !current || current.ivBase64Url !== block.ivBase64Url;
      });
      const reachableIvs = [
        latest.current.controlBlock.ivBase64Url,
        ...latest.current.factBlocks.map(({ ivBase64Url }) => ivBase64Url),
        ...previousChanged.map(({ ivBase64Url }) => ivBase64Url),
        ...parsed.value.candidates.map(
          ({ file }) => file.manifestAuthIvBase64Url,
        ),
      ];

      expect(new Set(reachableIvs).size).toBe(reachableIvs.length);
    },
    15_000,
  );

  it(
    "creates 300 then saves 301 and 302 as two adjacent independently decryptable full generations",
    async () => {
      const handle = new AtomicLedgerHandle();
      const adapter = new LedgerFileHandleAdapter();
      const generateId = createIdGenerator([
        "file-a",
        "revision-300",
        "revision-301",
        "revision-302",
      ]);
      const now = createClock([
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:01:00.000Z",
        "2026-07-28T10:02:00.000Z",
      ]);
      const ledger300 = createLedgerWithTrades(300);
      const repository = await LedgerFileRepository.create(
        adapter,
        handle,
        PASSPHRASE,
        ledger300,
        { generateId, now, sessionLease: TEST_SESSION_LEASE },
      );

      const first = await readVerifiedFile(handle);
      expect(handle.text()).not.toContain('"assets"');
      expect(handle.text()).not.toContain('"trades"');
      expect(handle.text()).not.toContain('"priceSnapshots"');
      expect(handle.text()).not.toContain('"feeRules"');
      expect(handle.text()).not.toContain('"savedAt"');
      expect(first.current.ledgerData.trades).toHaveLength(300);
      expect(first.previous).toBeNull();
      expect(first.file.current.parentRevisionId).toBeNull();

      const ledger301 = {
        ...ledger300,
        trades: [...ledger300.trades, createTrade(300, "BTC")],
      };
      await repository.save(ledger301);
      const second = await readVerifiedFile(handle);
      expect(second.current.ledgerData.trades).toHaveLength(301);
      expect(second.previous?.ledgerData.trades).toHaveLength(300);
      expect(second.file.current.parentRevisionId).toBe(
        second.file.previous?.revisionId,
      );
      expect(second.file.current.ivBase64Url).not.toBe(
        second.file.previous?.ivBase64Url,
      );

      const ledger302 = {
        ...ledger301,
        trades: [...ledger301.trades, createTrade(301, "ETH")],
      };
      await repository.save(ledger302);
      const third = await readVerifiedFile(handle);
      expect(third.current.ledgerData.trades).toHaveLength(302);
      expect(third.previous?.ledgerData.trades).toHaveLength(301);
      expect(third.file.current.revisionId).toBe("revision-302");
      expect(third.file.previous?.revisionId).toBe("revision-301");
      expect(third.file.current.parentRevisionId).toBe("revision-301");
      expect(third.file.crypto.kdf.saltBase64Url).toBe(
        first.file.crypto.kdf.saltBase64Url,
      );
      expect(new Set([
        first.file.current.ivBase64Url,
        second.file.current.ivBase64Url,
        third.file.current.ivBase64Url,
      ]).size).toBe(3);
      await expect(repository.load()).resolves.toEqual(ledger302);
      expect(handle.writeCount).toBe(3);
      expect(handle.closeCount).toBe(3);
    },
    15_000,
  );

  it("leaves the previous whole-ledger body slot byte-identical during an ordinary save", async () => {
    const handle = new AtomicLedgerHandle();
    const ledgerBefore = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerBefore,
      {
        generateId: createIdGenerator([
          "file-s2-previous-slot",
          "revision-s2-before",
          "revision-s2-after",
        ]),
        now: createClock([
          "2026-09-01T08:00:00.000Z",
          "2026-09-01T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const parsedBefore = readLedgerFileSlotViewForTest(handle.bytes);
    expect(parsedBefore.ok).toBe(true);
    if (!parsedBefore.ok) return;
    const sourceSlot = parsedBefore.value.current.bodySlot;
    const sourceSlotOffset = ledgerFileBodySlotOffsetV3S2(
      parsedBefore.value.bodySlotBytes,
      sourceSlot,
    );
    const sourceSlotBefore = readLedgerFileBodySlotForTest(
      handle.bytes,
      sourceSlot,
    );
    const operationsBeforeSave = handle.writeOperations.length;

    await repository.save({
      ...ledgerBefore,
      trades: [...ledgerBefore.trades, createTrade(3)],
    });

    const parsedAfter = readLedgerFileSlotViewForTest(handle.bytes);
    expect(parsedAfter.ok).toBe(true);
    if (!parsedAfter.ok) return;
    expect(parsedAfter.value.previous?.bodySlot).toBe(sourceSlot);
    expect(
      readLedgerFileBodySlotForTest(handle.bytes, sourceSlot),
    ).toEqual(sourceSlotBefore);
    const saveOperations = handle.writeOperations.slice(
      operationsBeforeSave,
    );
    expect(saveOperations).toHaveLength(2);
    expect(
      saveOperations.some(
        ({ position, byteLength }) =>
          position < sourceSlotOffset + sourceSlotBefore.byteLength &&
          position + byteLength > sourceSlotOffset,
      ),
    ).toBe(false);
  });
});
