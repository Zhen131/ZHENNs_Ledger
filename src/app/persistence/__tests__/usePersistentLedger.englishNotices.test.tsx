// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LedgerRepository } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import {
  LanguageProvider,
  translate,
  useLanguage,
  type LedgerLanguage,
} from "@/ui";
import {
  addTrade,
  createRepository,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

/**
 * 04B scenarios 5 and 8 at the hook: persistence notices are stored as keys and
 * translated with the current interface language when returned, so a notice
 * already on screen follows a language change; switching language never makes
 * the hook read the ledger again (04B revision 5). Import-policy rejections are
 * written in the language active when the import ran.
 */
const HAN = /[㐀-䶿一-鿿]/u;

function memoryStorage(language: LedgerLanguage) {
  let value: string = language;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function wrapperIn(language: LedgerLanguage) {
  const storage = memoryStorage(language);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <LanguageProvider storage={storage}>{children}</LanguageProvider>;
  };
}

function useLedgerWithLanguage(repository: LedgerRepository) {
  return { ledger: usePersistentLedger(repository), language: useLanguage() };
}

describe("persistence notices follow the interface language", () => {
  it("reports a failed read in English", async () => {
    const repository = createRepository({
      load: vi.fn(async () => {
        throw new Error("read failed");
      }),
    });
    const { result } = renderHook(() => useLedgerWithLanguage(repository), {
      wrapper: wrapperIn("en"),
    });

    await waitFor(() =>
      expect(result.current.ledger.persistenceError).toBe(
        translate("en", "persistence.readFailed"),
      ),
    );
    expect(result.current.ledger.persistenceError).not.toMatch(HAN);
  });

  it("re-words a save failure already shown when the language changes", async () => {
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValue(new Error("write failed"));
    const repository = createRepository({ save });
    const { result } = renderHook(() => useLedgerWithLanguage(repository), {
      wrapper: wrapperIn("zh-CN"),
    });
    await waitFor(() =>
      expect(result.current.ledger.hydrationStatus).toBe("ready"),
    );

    act(() => {
      addTrade(
        result.current.ledger.applyLedgerAction,
        createSimpleTrade("trade-kept", "buy", "BTC", "1"),
      );
    });
    await waitFor(() =>
      expect(result.current.ledger.persistenceError).toBe(
        translate("zh-CN", "persistence.saveFailed"),
      ),
    );
    const loadsBefore = vi.mocked(repository.load).mock.calls.length;
    const savesBefore = save.mock.calls.length;

    act(() => result.current.language.setLanguage("en"));

    await waitFor(() =>
      expect(result.current.ledger.persistenceError).toBe(
        translate("en", "persistence.saveFailed"),
      ),
    );
    expect(result.current.ledger.persistenceError).not.toMatch(HAN);
    expect(vi.mocked(repository.load).mock.calls.length).toBe(loadsBefore);
    expect(save.mock.calls.length).toBe(savesBefore);
  });

  it("rejects an import with a future trade in English", async () => {
    const repository = createRepository();
    const { result } = renderHook(() => useLedgerWithLanguage(repository), {
      wrapper: wrapperIn("en"),
    });
    await waitFor(() =>
      expect(result.current.ledger.hydrationStatus).toBe("ready"),
    );
    const candidate = createInitialLedgerData();
    candidate.trades = [
      createSimpleTrade("trade-later", "buy", "BTC", "1", "2026-07-30"),
    ];

    let outcome!: Awaited<
      ReturnType<typeof result.current.ledger.replaceLedgerFromBackup>
    >;
    await act(async () => {
      outcome = await result.current.ledger.replaceLedgerFromBackup(candidate);
    });

    expect(outcome).toMatchObject({
      ok: false,
      code: "LEDGER_IMPORT_INVALID_BACKUP",
    });
    const errors = !outcome.ok && "errors" in outcome ? outcome.errors ?? [] : [];
    const messages = errors.map((error) => error.message);
    expect(messages).toEqual([
      translate("en", "policy.import.futureTradePrefix") +
        "2026-07-30" +
        translate("en", "policy.import.futureFactMiddle") +
        "2026-07-25",
    ]);
    expect(messages.join(" ")).not.toMatch(HAN);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
