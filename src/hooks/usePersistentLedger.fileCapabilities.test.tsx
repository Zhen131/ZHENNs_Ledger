// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerRepository } from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import type { LedgerClock } from "../utils/ledgerDate";
import { usePersistentLedger } from "./usePersistentLedger";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-28T12:00:00.000Z"),
};

afterEach(cleanup);

describe("usePersistentLedger file session capabilities", () => {
  it("rejects clear and B import before invoking a file repository", async () => {
    const repository: LedgerRepository = {
      load: vi.fn(async () => createInitialLedgerData()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClear: false,
        canImportBackup: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      await expect(
        result.current.replaceLedgerFromBackup(createInitialLedgerData()),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(repository.clear).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
