// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEDGER_LANGUAGE,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
  LanguageProvider,
  useLanguage,
} from "./i18n";

function LanguageProbe() {
  const { language, setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage("en")} type="button">
      {language}
    </button>
  );
}

describe("LanguageProvider", () => {
  it("changes the in-memory language and persists the browser preference", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "zh-CN" }));

    expect(screen.getByRole("button", { name: "en" })).toBeTruthy();
    expect(window.localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe(
      "en",
    );
  });

  it("starts the next test in Chinese without leaked language state", () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("button", { name: DEFAULT_LEDGER_LANGUAGE }),
    ).toBeTruthy();
  });
});
