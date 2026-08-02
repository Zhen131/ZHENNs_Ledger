// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LedgerData } from "../../models";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { sampleTradeDrafts } from "../../test/fixtures";
import { isWithinTolerance } from "../../utils/decimalMath";
import type { LedgerClock } from "../../utils/ledgerDate";
import { DashboardShell as DashboardShellRuntime } from "./DashboardShell";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

function DashboardShell({
  repository,
}: {
  repository: LedgerRepository;
}) {
  return (
    <DashboardShellRuntime clock={fixedClock} repository={repository} />
  );
}

vi.mock("../charts/EChart", () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div aria-label={ariaLabel} role="img" />
  ),
}));

afterEach(() => {
  cleanup();
});

function createMemoryRepository(): LedgerRepository {
  let storedData: LedgerData | null = null;

  return {
    load: vi.fn(async () =>
      storedData === null ? null : structuredClone(storedData),
    ),
    save: vi.fn(async (ledgerData) => {
      storedData = structuredClone(ledgerData);
    }),
    clear: vi.fn(async () => {
      storedData = null;
    }),
  };
}

function getSection(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title }).closest("section");

  if (!section) {
    throw new Error(`Section not found: ${title}`);
  }

  return section;
}

function getPositionRow(assetSymbol: string): HTMLTableRowElement {
  const assetCell = within(getSection("Asset Summary")).getByText(assetSymbol);
  const row = assetCell.closest("tr");

  if (!row) {
    throw new Error(`Position row not found: ${assetSymbol}`);
  }

  return row;
}

function getPositionCellValue(
  assetSymbol: string,
  columnIndex: number,
): string {
  const cells = within(getPositionRow(assetSymbol)).getAllByRole("cell");
  const text = cells[columnIndex]?.textContent?.trim();

  if (!text) {
    throw new Error(
      `Position cell not found: ${assetSymbol} column ${columnIndex}`,
    );
  }

  return text;
}

function expectPositionDecimal(
  assetSymbol: string,
  columnIndex: number,
  expected: string,
) {
  const actual = getPositionCellValue(assetSymbol, columnIndex).replace(
    /\s+USD$/,
    "",
  );

  expect(isWithinTolerance(actual, expected, "0.0000000001")).toBe(true);
}

async function fillTradeForm(input: {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
  fee: string;
}) {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("Type", { selector: "select" }),
    input.type,
  );
  await user.selectOptions(
    screen.getByLabelText("Asset", { selector: "select" }),
    input.assetSymbol,
  );

  const fields = [
    ["Quantity", input.quantity],
    ["Average execution price", input.price],
    ["Total amount", input.totalValue],
    ["Date", input.occurredAt],
    ["Fee", input.fee],
  ] as const;

  for (const [label, value] of fields) {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
  }

  await user.click(screen.getByRole("button", { name: "Save trade" }));
}

async function enterGoldenTrades() {
  for (const draft of sampleTradeDrafts) {
    await fillTradeForm({
      type: draft.type,
      assetSymbol: draft.assetSymbol,
      quantity: draft.quantity,
      price: draft.price,
      totalValue: draft.totalValue,
      occurredAt: draft.occurredAt,
      fee: draft.fee ?? "0",
    });

    expect(screen.getByText("Trade added to the ledger")).not.toBeNull();
  }
}

describe("DashboardShell golden UI acceptance", () => {
  it("runs golden, price, oversell, and deletion scenarios through the real forms", async () => {
    render(<DashboardShell repository={createMemoryRepository()} />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading the local ledger. No data will be written until loading completes."),
      ).toBeNull();
    });

    await enterGoldenTrades();

    const tradeSection = getSection("Trade List");
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);

    expectPositionDecimal("BTC", 1, "0.24265306");
    expectPositionDecimal("BTC", 3, "11");
    expectPositionDecimal("BTC", 4, "0");
    expectPositionDecimal("ETH", 1, "0.400040");
    expectPositionDecimal("ETH", 3, "10");
    expectPositionDecimal("ETH", 4, "0");
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Price asset", { selector: "select" }),
      "BTC",
    );
    await user.type(screen.getByLabelText("Current price"), "70000");
    await user.type(screen.getByLabelText("Price date"), "2026-04-15");
    await user.click(screen.getByRole("button", { name: "Save price" }));

    expect(screen.getByText("Price added to the ledger")).not.toBeNull();
    expectPositionDecimal("BTC", 5, "70000");
    expectPositionDecimal("BTC", 6, "11.4716");
    expectPositionDecimal("BTC", 7, "0.4716");
    expect(screen.getByText(/1 valued assets; total market value 11.4716 USD equivalent/)).not.toBeNull();
    expect(screen.getByText("Unvalued assets: ADA, ETH.")).not.toBeNull();
    expect(screen.getByText(/365 calendar days and 5 trades/)).not.toBeNull();

    await fillTradeForm({
      type: "sell",
      assetSymbol: "ADA",
      quantity: "85.3245",
      price: "1",
      totalValue: "85.3245",
      occurredAt: "2026-04-15",
      fee: "0",
    });

    expect(
      screen.getByText("Sell quantity exceeds the available position at that time"),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");

    const supportedBuyDeleteButton = within(tradeSection).getByRole("button", {
      name: "Delete buy ADA 2026-04-09",
    });
    await user.click(supportedBuyDeleteButton);
    await user.click(supportedBuyDeleteButton);

    expect(
      within(tradeSection).getByText(
        "Cannot delete: this trade supports a later sell. Delete dependent later sells first.",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);

    const independentBuyDeleteButton = within(tradeSection).getByRole(
      "button",
      {
        name: "Delete buy BTC 2026-04-02",
      },
    );
    await user.click(independentBuyDeleteButton);
    await user.click(independentBuyDeleteButton);

    expect(within(tradeSection).getAllByRole("row")).toHaveLength(5);
    expect(within(getSection("Asset Summary")).queryByText("BTC")).toBeNull();
    expectPositionDecimal("ETH", 1, "0.400040");
    expectPositionDecimal("ETH", 3, "10");
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");
  });
});
