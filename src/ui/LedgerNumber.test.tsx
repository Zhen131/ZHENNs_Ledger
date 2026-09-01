// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LedgerNumber, type LedgerNumberKind } from "./LedgerNumber";

describe("LedgerNumber", () => {
  it.each([
    ["money", "594.862375883946480045", "594.86"],
    ["quantity", "6638.73487823", "6 638.7349"],
    ["percent", "0.0679", "+6.79%"],
  ] as const)(
    "renders %s text while exposing the unformatted value",
    (kind, value, expectedText) => {
      render(<LedgerNumber kind={kind} value={value} />);

      const number = screen.getByTitle(value);
      expect(number.textContent).toBe(expectedText);
      expect(number.getAttribute("title")).toBe(value);
      expect(number.getAttribute("aria-label")).toBe(value);
      expect(number.classList.contains("ledger-numeric")).toBe(true);
    },
  );

  it("keeps an editable decimal draft unchanged at the display boundary", async () => {
    function Harness() {
      const [draft, setDraft] = useState("");
      return (
        <>
          <input
            aria-label="decimal draft"
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <LedgerNumber
            kind="money"
            value={draft === "" ? "0" : draft}
          />
        </>
      );
    }

    render(<Harness />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("decimal draft") as HTMLInputElement;
    await user.type(input, "6492.3391");

    expect(input.value).toBe("6492.3391");
    expect(screen.getByTitle("6492.3391").textContent).toBe("6 492.34");
  });

  it("supports inline currency text and caller styling", () => {
    render(
      <p>
        <LedgerNumber className="font-semibold" kind={"money" as LedgerNumberKind} value="12.5" />{" "}
        USDT
      </p>,
    );

    const number = screen.getByTitle("12.5");
    expect(number.classList.contains("font-semibold")).toBe(true);
    expect(number.parentElement?.textContent).toBe("12.50 USDT");
  });

  it("keeps ordinary thousands spaces unbroken through ledger-numeric", () => {
    render(<LedgerNumber kind="money" value="1234567.89" />);

    const number = screen.getByTitle("1234567.89");
    const separatorCodePoints = [...(number.textContent ?? "")]
      .filter((character) => character === " ")
      .map((character) => character.codePointAt(0));
    const globalStyles = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(number.textContent).toBe("1 234 567.89");
    expect(separatorCodePoints).toEqual([0x20, 0x20]);
    expect(number.classList.contains("ledger-numeric")).toBe(true);
    expect(globalStyles).toMatch(
      /\.ledger-numeric\s*\{[^}]*white-space:\s*nowrap;/,
    );
  });
});
