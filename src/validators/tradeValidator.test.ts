import assert from "node:assert/strict";

import type { Trade, TradeDraft } from "../models";
import { calculatePositions } from "../calculators/positionCalculator";
import {
  createSimpleTrade,
  createTradeFromDraft,
  sampleAssets,
  sampleTradeDrafts,
} from "../test/fixtures";
import {
  TRADE_VALIDATION_ERROR_CODES,
  type TradeValidationErrorCode,
  type TradeValidationField,
  type TradeValidationResult,
  validateTradeDraft,
} from "./tradeValidator";

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const validDraft = sampleTradeDrafts[0];

const context = {
  assets: sampleAssets,
  priorTrades: [],
};

test("rejects a non-object input before reading fields", () => {
  expectError(
    validateTradeDraft("not-an-object", context),
    TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
    "input",
  );
});

test("accepts all five fixed trade drafts", () => {
  const priorTrades: Trade[] = [];

  for (const [index, draft] of sampleTradeDrafts.entries()) {
    const result = validateTradeDraft(draft, {
      ...context,
      priorTrades,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      priorTrades.push(
        createTradeFromDraft(result.value, `sample-${index + 1}`),
      );
    }
  }
});

test("does not apply an oversell check to buy trades", () => {
  assert.equal(validateTradeDraft(validDraft, context).ok, true);
});

test("rejects a sell when there is no holding", () => {
  expectError(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "1"), context),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("rejects a sell quantity greater than the current holding", () => {
  expectError(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "11"), {
      ...context,
      priorTrades: [createSimpleTrade("buy-ada", "buy", "ADA", "10")],
    }),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("allows selling exactly the current holding", () => {
  assert.equal(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "10"), {
      ...context,
      priorTrades: [createSimpleTrade("buy-ada", "buy", "ADA", "10")],
    }).ok,
    true,
  );
});

test("allows a partial sell after multiple buys", () => {
  assert.equal(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "12"), {
      ...context,
      priorTrades: [
        createSimpleTrade("buy-ada-1", "buy", "ADA", "5"),
        createSimpleTrade("buy-ada-2", "buy", "ADA", "10"),
      ],
    }).ok,
    true,
  );
});

test("uses the remaining holding after an earlier sell", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "6", "2026-04-02"),
  ];

  assert.equal(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "4"), {
      ...context,
      priorTrades,
    }).ok,
    true,
  );
  expectError(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "4.1"), {
      ...context,
      priorTrades,
    }),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("does not use another asset holding to support a sell", () => {
  expectError(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "1"), {
      ...context,
      priorTrades: [createSimpleTrade("buy-btc", "buy", "BTC", "10")],
    }),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("sorts prior trades chronologically before checking holdings", () => {
  const priorTrades = [
    createSimpleTrade("sell-ada", "sell", "ADA", "4", "2026-04-02"),
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
  ];

  assert.equal(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "6"), {
      ...context,
      priorTrades,
    }).ok,
    true,
  );
});

test("keeps input order stable for prior trades at the same time", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "4", "2026-04-01"),
  ];

  assert.equal(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "6"), {
      ...context,
      priorTrades,
    }).ok,
    true,
  );
});

test("accepts a total value difference within the default tolerance", () => {
  assert.equal(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.991",
      },
      context,
    ).ok,
    true,
  );
});

test("accepts a total value difference exactly at the tolerance boundary", () => {
  assert.equal(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.99",
      },
      context,
    ).ok,
    true,
  );
});

test("rejects a total value difference above the tolerance boundary", () => {
  expectError(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.989",
      },
      context,
    ),
    TRADE_VALIDATION_ERROR_CODES.TOTAL_VALUE_MISMATCH,
    "totalValue",
  );
});

test("includes calculated values in a total value mismatch message", () => {
  const result = validateTradeDraft(
    {
      ...validDraft,
      quantity: "2",
      price: "5",
      totalValue: "9.5",
    },
    context,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    const mismatch = result.errors.find(
      (error) =>
        error.code === TRADE_VALIDATION_ERROR_CODES.TOTAL_VALUE_MISMATCH,
    );

    assert.ok(mismatch);
    assert.match(mismatch.message, /10/);
    assert.match(mismatch.message, /9\.5/);
    assert.match(mismatch.message, /0\.01/);
  }
});

test("supports a caller-provided total value tolerance", () => {
  assert.equal(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.98",
      },
      {
        ...context,
        totalValueTolerance: "0.02",
      },
    ).ok,
    true,
  );
});

test("rejects an invalid total value tolerance without throwing", () => {
  expectError(
    validateTradeDraft(validDraft, {
      ...context,
      totalValueTolerance: "-0.01",
    }),
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    "totalValueTolerance",
  );
});

test("defaults an omitted fee to zero", () => {
  const result = validateTradeDraft(validDraft, context);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.fee, "0");
  }
});

test("rejects an invalid trade type", () => {
  expectError(
    validateTradeDraft({ ...validDraft, type: "transfer" }, context),
    TRADE_VALIDATION_ERROR_CODES.INVALID_TRADE_TYPE,
    "type",
  );
});

test("rejects an asset that does not exist", () => {
  expectError(
    validateTradeDraft({ ...validDraft, assetSymbol: "DOGE" }, context),
    TRADE_VALIDATION_ERROR_CODES.ASSET_NOT_FOUND,
    "assetSymbol",
  );
});

test("rejects invalid and non-positive quantities", () => {
  expectDecimalErrors("quantity");
});

test("rejects invalid and non-positive prices", () => {
  expectDecimalErrors("price");
});

test("rejects invalid and non-positive total values", () => {
  expectDecimalErrors("totalValue");
});

test("rejects invalid and negative fees", () => {
  expectError(
    validateTradeDraft({ ...validDraft, fee: "not-a-number" }, context),
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    "fee",
  );
  expectError(
    validateTradeDraft({ ...validDraft, fee: "-0.01" }, context),
    TRADE_VALIDATION_ERROR_CODES.FEE_MUST_BE_NON_NEGATIVE,
    "fee",
  );
});

test("returns multiple field errors in one result", () => {
  const result = validateTradeDraft(
    {
      ...validDraft,
      type: "transfer",
      assetSymbol: "DOGE",
      quantity: "0",
      fee: "-1",
    },
    context,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 4);
  }
});

test("does not call the calculator or change positions after validation fails", () => {
  const priorTrades = [createSimpleTrade("buy-ada", "buy", "ADA", "10")];
  const positionsBefore = calculatePositions(priorTrades);
  const result = validateTradeDraft(createSimpleDraft("sell", "ADA", "11"), {
    ...context,
    priorTrades,
  });
  let calculatorCalls = 0;

  if (result.ok) {
    calculatorCalls += 1;
    calculatePositions([
      ...priorTrades,
      createTradeFromDraft(result.value, "invalid-sell"),
    ]);
  }

  assert.equal(result.ok, false);
  assert.equal(calculatorCalls, 0);
  assert.deepEqual(calculatePositions(priorTrades), positionsBefore);
  assert.equal(priorTrades.length, 1);
});

function createSimpleDraft(
  type: "buy" | "sell",
  assetSymbol: string,
  quantity: string,
): TradeDraft {
  return {
    ...validDraft,
    type,
    assetSymbol,
    quantity,
    price: "1",
    totalValue: quantity,
  };
}

function expectDecimalErrors(field: "quantity" | "price" | "totalValue") {
  expectError(
    validateTradeDraft({ ...validDraft, [field]: "not-a-number" }, context),
    TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
    field,
  );
  expectError(
    validateTradeDraft({ ...validDraft, [field]: "0" }, context),
    TRADE_VALIDATION_ERROR_CODES.VALUE_MUST_BE_POSITIVE,
    field,
  );
  expectError(
    validateTradeDraft({ ...validDraft, [field]: "-1" }, context),
    TRADE_VALIDATION_ERROR_CODES.VALUE_MUST_BE_POSITIVE,
    field,
  );
}

function expectError(
  result: TradeValidationResult,
  code: TradeValidationErrorCode,
  field: TradeValidationField,
) {
  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.errors.some(
        (error) => error.code === code && error.field === field,
      ),
      `Expected ${code} for ${field}`,
    );
  }
}
