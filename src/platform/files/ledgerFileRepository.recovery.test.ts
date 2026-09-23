import { describe, expect, it } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
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
  AtomicLedgerHandle,
  createIdGenerator,
  createClock,
  createTrade,
  createLedgerWithTrades,
  replaceLedgerFileSalt,
  replacePublishedLedgerFile,
  createSessionLease,
  corruptCurrentCiphertext,
  corruptPreviousCiphertext,
  replaceCurrentPlaintext,
  replacePreviousPlaintext,
  reencryptCurrentWithSamePlaintext,
  readVerifiedFile,
  createTwoGenerationLedgerFile,
} from "./ledgerFileRepository.testHelpers";

describe("LedgerFileRepository", () => {
  it(
    "offers an explicit recovery candidate and restores exactly the independently verified previous generation",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      const publishedFile = readLedgerFileForTest(published302);
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const recoveryLease = createSessionLease("recovery-success");

      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          expectedFileId: "file-recovery",
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: recoveryLease,
        },
      );

      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      const recovered = await opened.candidate.confirm();
      await expect(recovered.load()).resolves.toEqual(ledger301);
      const verified = await readVerifiedFile(handle);
      expect(verified.current.ledgerData).toEqual(ledger301);
      expect(verified.current.savedAt).toBe(
        "2026-07-28T10:02:00.000Z",
      );
      expect(verified.file.current.revisionId).toBe(
        "revision-recovered",
      );
      expect(verified.file.current.parentRevisionId).toBe(
        "revision-301",
      );
      expect(verified.file.previous).toEqual(
        publishedFile.previous,
      );
      expect(verified.previous?.ledgerData).toEqual(ledger301);
      expect(handle.writeCount).toBe(3);
    },
    15_000,
  );

  it(
    "cancels a recovery candidate with zero writes and releases its own lease",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const recoveryLease = createSessionLease("recovery-cancel");
      const writesBeforeCancel = handle.writeCount;
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          sessionLease: recoveryLease,
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;

      await opened.candidate.cancel();

      expect(handle.writeCount).toBe(writesBeforeCancel);
      expect(recoveryLease.release).toHaveBeenCalledOnce();
    },
    15_000,
  );

  it(
    "requires a valid previous generation and never turns a wrong password into a recovery oracle",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();

      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      await expect(
        LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          "wrong password that is long enough",
          {
            sessionLease: createSessionLease(
              "recovery-wrong-password",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });

      replacePublishedLedgerFile(
        handle,
        corruptPreviousCiphertext(published302),
      );
      await expect(
        LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              "recovery-invalid-previous",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });
    },
    15_000,
  );

  it(
    "rejects every ineligible recovery source with zero writes",
    async () => {
      const adapter = new LedgerFileHandleAdapter();
      const oneGenerationHandle = new AtomicLedgerHandle();
      await LedgerFileRepository.create(
        adapter,
        oneGenerationHandle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator([
            "file-one-generation",
            "revision-one-generation",
          ]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-matrix-one-generation-create",
          ),
        },
      );
      replacePublishedLedgerFile(
        oneGenerationHandle,
        corruptCurrentCiphertext(oneGenerationHandle.text()),
      );
      const oneGenerationWrites = oneGenerationHandle.writeCount;
      await expect(
        LedgerFileRepository.openForAccess(
          adapter,
          oneGenerationHandle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              "recovery-matrix-no-previous",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });
      expect(oneGenerationHandle.writeCount).toBe(
        oneGenerationWrites,
      );

      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      const verified302 = await readVerifiedFile(handle);
      const previousValidatorFailure = JSON.stringify({
        ...verified302.previous,
        ledgerData: {
          ...verified302.previous!.ledgerData,
          schemaVersion: 1,
        },
      });
      const previousResourceFailure = JSON.stringify({
        ...verified302.previous,
        ledgerData: {
          ...verified302.previous!.ledgerData,
          trades: [
            {
              ...verified302.previous!.ledgerData.trades[0],
              note: "x".repeat(4_097),
            },
          ],
        },
      });
      const publishedFile = readLedgerFileForTest(published302);
      const ineligibleCases: Array<{
        name: string;
        serialized: string;
        expectedFileId?: string;
        code: string;
      }> = [
        {
          name: "both generations fail authentication",
          serialized: corruptPreviousCiphertext(
            corruptCurrentCiphertext(published302),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "expected file identity differs",
          serialized: corruptCurrentCiphertext(published302),
          expectedFileId: "different-file-id",
          code: LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
        },
        {
          name: "revision chain is not adjacent",
          serialized: serializeLedgerFileForTest({
            ...publishedFile,
            current: {
              ...publishedFile.current,
              parentRevisionId: "untrusted-parent",
            },
          }),
          code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
        },
        {
          name: "crypto metadata no longer authenticates the source",
          serialized: replaceLedgerFileSalt(
            corruptCurrentCiphertext(published302),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "previous fails the ledger validator",
          serialized: corruptCurrentCiphertext(
            await replacePreviousPlaintext(
              published302,
              previousValidatorFailure,
            ),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "previous exceeds the resource policy",
          serialized: corruptCurrentCiphertext(
            await replacePreviousPlaintext(
              published302,
              previousResourceFailure,
            ),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
      ];

      for (const recoveryCase of ineligibleCases) {
        replacePublishedLedgerFile(handle, recoveryCase.serialized);
        const writesBeforeOpen = handle.writeCount;
        await expect(
          LedgerFileRepository.openForAccess(
            adapter,
            handle,
            PASSPHRASE,
            {
              expectedFileId: recoveryCase.expectedFileId,
              sessionLease: createSessionLease(
                `recovery-matrix-${recoveryCase.name}`,
              ),
            },
          ),
          recoveryCase.name,
        ).rejects.toMatchObject({ code: recoveryCase.code });
        expect(
          handle.writeCount,
          recoveryCase.name,
        ).toBe(writesBeforeOpen);
      }
    },
    30_000,
  );

  it(
    "offers recovery for authenticated current JSON, Validator, and ResourcePolicy failures",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      const verified302 = await readVerifiedFile(handle);
      const invalidValidatorPayload = JSON.stringify({
        ...verified302.current,
        ledgerData: {
          ...verified302.current.ledgerData,
          schemaVersion: 1,
        },
      });
      const oversizedPayload = JSON.stringify({
        ...verified302.current,
        ledgerData: {
          ...verified302.current.ledgerData,
          trades: [
            {
              ...verified302.current.ledgerData.trades[0],
              note: "x".repeat(4_097),
            },
          ],
        },
      });
      const damagedFiles = [
        await replaceCurrentPlaintext(published302, "{"),
        await replaceCurrentPlaintext(
          published302,
          invalidValidatorPayload,
        ),
        await replaceCurrentPlaintext(
          published302,
          oversizedPayload,
        ),
      ];

      for (const [index, damaged] of damagedFiles.entries()) {
        replacePublishedLedgerFile(handle, damaged);
        const opened = await LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              `recovery-payload-${index}`,
            ),
          },
        );
        expect(opened.status).toBe("recovery-required");
        if (opened.status === "recovery-required") {
          await opened.candidate.cancel();
        }
      }
    },
    15_000,
  );

  it(
    "stops recovery with zero writes when the exact prompted baseline changes",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-external-change",
          ),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      const writesBeforeConfirm = handle.writeCount;
      replacePublishedLedgerFile(handle, published302);

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
      });
      expect(handle.writeCount).toBe(writesBeforeConfirm);
      expect(handle.text()).toBe(published302);
      await opened.candidate.cancel();
    },
    15_000,
  );

  it(
    "reconciles the same recovery intent after close succeeded but readback was not confirmed",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease("recovery-reconcile"),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      handle.failReadAfterClose = true;

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      });
      expect(handle.writeCount).toBe(3);
      const recovered = await opened.candidate.confirm();

      expect(handle.writeCount).toBe(3);
      await expect(recovered.load()).resolves.toEqual(ledger301);
      expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
        "revision-recovered",
      );
    },
    15_000,
  );

  it(
    "rejects recovery readback when an outside writer re-encrypts the same recovered payload",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-exact-generation",
          ),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      });
      expect((await readVerifiedFile(handle)).current.ledgerData).toEqual(
        ledger301,
      );
      await opened.candidate.cancel();
    },
    15_000,
  );

  it(
    "re-reads before no-op and refuses to overwrite an externally saved R302",
    async () => {
      const handle = new AtomicLedgerHandle();
      const ledger301 = createLedgerWithTrades(3);
      const staleRepository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger301,
        {
          generateId: createIdGenerator([
            "file-external",
            "revision-301",
          ]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease("stale-page"),
        },
      );
      const externalRepository = await LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-302"]),
          now: createClock(["2026-07-28T10:01:00.000Z"]),
          sessionLease: createSessionLease("external-program"),
        },
      );
      const ledger302 = {
        ...ledger301,
        trades: [...ledger301.trades, createTrade(3, "ETH")],
      };
      await externalRepository.save(ledger302);
      const disk302 = handle.text();
      const writesAfterExternal = handle.writeCount;

      await expect(
        staleRepository.save(structuredClone(ledger301)),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
      });

      expect(handle.writeCount).toBe(writesAfterExternal);
      expect(handle.text()).toBe(disk302);
      await expect(externalRepository.load()).resolves.toEqual(
        ledger302,
      );
      await expect(staleRepository.load()).resolves.toEqual(ledger301);
    },
    15_000,
  );
});
