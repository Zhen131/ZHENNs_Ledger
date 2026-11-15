// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { LanguageProvider, translate, type LedgerLanguage } from "@/ui";
import { CashEventPanel } from "../CashEventPanel";

/**
 * 04B scenario 3: the cash form's validation messages come from
 * `cashEventService.ts` and follow the interface language. On the Chinese
 * interface they stay exactly as before.
 */
const HAN = /[㐀-䶿一-鿿]/u;
const clock: LedgerClock = { now: () => new Date("2026-08-18T08:00:00.000Z") };

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "cash-new") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function memoryStorage(language: LedgerLanguage) {
  let value: string = language;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function renderIn(language: LedgerLanguage) {
  const onCreate = vi.fn(() => "applied" as const);
  render(
    <LanguageProvider storage={memoryStorage(language)}>
      <CashEventPanel
        clock={clock}
        isWritable
        ledgerData={createInitialLedgerData()}
        ledgerEpoch={1}
        mutationVersion={0}
        onCashEventCreated={onCreate}
        onCashEventDeleted={vi.fn(() => "applied" as const)}
        persistedVersion={0}
        persistenceStatus="saved"
      />
    </LanguageProvider>,
  );
  return onCreate;
}

async function submitAmount(language: LedgerLanguage, amount: string) {
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText(translate(language, "cash.field.amount")),
    amount,
  );
  await user.click(
    screen.getByRole("button", { name: translate(language, "cash.action.save") }),
  );
}

describe("cash form errors follow the interface language", () => {
  it("rejects a zero deposit in English", async () => {
    const onCreate = renderIn("en");
    await submitAmount("en", "0");

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText(translate("en", "cash.validation.positiveAmount")),
    ).not.toBeNull();
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("rejects a zero deposit with the original Chinese sentence", async () => {
    renderIn("zh-CN");
    await submitAmount("zh-CN", "0");

    expect(
      screen.getByText(translate("zh-CN", "cash.validation.positiveAmount")),
    ).not.toBeNull();
  });

  it("rejects a date after today in English", async () => {
    const onCreate = renderIn("en");
    fireEvent.change(
      await screen.findByLabelText(translate("en", "cash.field.date")),
      { target: { value: "2026-08-20" } },
    );
    await submitAmount("en", "10");

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText(translate("en", "cash.validation.futureFact")),
    ).not.toBeNull();
    expect(document.body.textContent).not.toMatch(HAN);
  });
});
