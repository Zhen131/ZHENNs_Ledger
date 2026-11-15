// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LanguageProvider, useLanguage } from "../i18n";

/**
 * The root layout hard-codes `<html lang="zh-CN">`. Once the interface is in
 * English the page must stop declaring itself Chinese, or the browser offers
 * to translate an English page (04B revision 8).
 */
afterEach(() => {
  cleanup();
  document.documentElement.lang = "zh-CN";
});

function memoryStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return (
    <>
      <span data-testid="language">{language}</span>
      <button onClick={() => setLanguage("en")} type="button">
        to-en
      </button>
      <button onClick={() => setLanguage("zh-CN")} type="button">
        to-zh
      </button>
    </>
  );
}

describe("html lang follows the interface language", () => {
  it("is en after switching to English and zh-CN after switching back", async () => {
    render(
      <LanguageProvider storage={memoryStorage()}>
        <LanguageSwitch />
      </LanguageProvider>,
    );
    expect(document.documentElement.lang).toBe("zh-CN");

    await act(async () => screen.getByText("to-en").click());
    expect(screen.getByTestId("language").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    await act(async () => screen.getByText("to-zh").click());
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("is en when the stored preference is English", async () => {
    render(
      <LanguageProvider storage={memoryStorage("en")}>
        <LanguageSwitch />
      </LanguageProvider>,
    );
    await act(async () => undefined);
    expect(document.documentElement.lang).toBe("en");
  });
});
