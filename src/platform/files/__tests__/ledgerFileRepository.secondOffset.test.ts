import { describe, expect, it } from "vitest";

import type { DecryptedLedgerPayloadV4 } from "../ledgerFileContract";
import { LedgerFileHandleAdapter } from "../ledgerFileHandleAdapter";
import { LedgerFileRepository } from "../ledgerFileRepository";
import { LEDGER_FILE_REPOSITORY_ERROR_CODES } from "../ledgerFileRepositoryContract";
import {
  PASSPHRASE,
  createSessionLease,
  createTwoGenerationLedgerFile,
  readVerifiedFile,
  replaceCurrentPlaintext,
  replacePreviousPlaintext,
  replacePublishedLedgerFile,
} from "./ledgerFileRepository.testHelpers";

function withSecondOffsetTrade(payload: DecryptedLedgerPayloadV4): string {
  const [first, ...rest] = payload.ledgerData.trades;
  if (!first) throw new Error("fixture requires a trade");
  return JSON.stringify({
    ...payload,
    ledgerData: {
      ...payload.ledgerData,
      trades: [
        {
          ...first,
          occurredAt: "1850-06-01T12:00:00-05:00",
          occurredTimeZone: "America/New_York",
          timePrecision: "minute",
        },
        ...rest,
      ],
    },
  });
}

describe("LedgerFileRepository with a second-precision zone offset", () => {
  it(
    "offers the previous generation instead of throwing when only current holds the record",
    async () => {
      const { handle, published302 } = await createTwoGenerationLedgerFile();
      const verified = await readVerifiedFile(handle);
      replacePublishedLedgerFile(
        handle,
        await replaceCurrentPlaintext(
          published302,
          withSecondOffsetTrade(verified.current),
        ),
      );
      const writesBeforeOpen = handle.writeCount;

      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        { sessionLease: createSessionLease("second-offset-current") },
      );

      expect(opened.status).toBe("recovery-required");
      if (opened.status === "recovery-required") {
        await opened.candidate.cancel();
      }
      expect(handle.writeCount).toBe(writesBeforeOpen);
    },
    15_000,
  );

  it(
    "rejects with a repository error when both generations hold the record",
    async () => {
      const { handle, published302 } = await createTwoGenerationLedgerFile();
      const verified = await readVerifiedFile(handle);
      if (!verified.previous) throw new Error("fixture requires a previous generation");
      const currentDamaged = await replaceCurrentPlaintext(
        published302,
        withSecondOffsetTrade(verified.current),
      );
      replacePublishedLedgerFile(
        handle,
        await replacePreviousPlaintext(
          currentDamaged,
          withSecondOffsetTrade(verified.previous),
        ),
      );
      const writesBeforeOpen = handle.writeCount;

      const outcome = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        { sessionLease: createSessionLease("second-offset-both") },
      ).then(
        (opened) => ({ kind: "opened" as const, status: opened.status }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );

      expect(outcome.kind).toBe("rejected");
      if (outcome.kind === "rejected") {
        expect(outcome.error).not.toBeInstanceOf(RangeError);
        expect(outcome.error).toMatchObject({
          code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        });
      }
      expect(handle.writeCount).toBe(writesBeforeOpen);
    },
    15_000,
  );
});
