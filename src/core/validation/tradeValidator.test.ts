import { expect, test } from "vitest";

import type { Trade, TradeDraft } from "@/core/models";
import { calculatePositions } from "@/core/calculations";
import { createInitialLedgerData } from "@/core/state";
import {
  createSimpleTrade,
  createTradeFromDraft,
  sampleAssets,
  sampleTradeDrafts,
} from "@/test-support";
import {
  TRADE_VALIDATION_ERROR_CODES,
  type TradeValidationErrorCode,
  type TradeValidationField,
  type TradeValidationResult,
  validateTradeDraft,
} from "./tradeValidator";

const validDraft = sampleTradeDrafts[0];

const context = {
  assets: sampleAssets,
  priorTrades: [],
};

const strictContext = {
  assets: createInitialLedgerData().assets,
  priorTrades: [],
  requiredCurrency: "USDT",
  requireFeeCurrencyMatch: true,
};

test("rejects a non-object input before reading fields", () => {
  expectError(
    validateTradeDraft("not-an-object", context),
    TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
    "input",
  );
});

test("rejects a non-ISO or impossible trade date", () => {
  expectError(
    validateTradeDraft(
      { ...validDraft, occurredAt: "2026-02-30" },
      context,
    ),
    TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
    "occurredAt",
  );
  expectError(
    validateTradeDraft(
      { ...validDraft, occurredAt: "July 16, 2026" },
      context,
    ),
    TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
    "occurredAt",
  );
});

test("accepts all five fixed trade drafts using production built-in assets", () => {
  const priorTrades: Trade[] = [];

  for (const [index, draft] of sampleTradeDrafts.entries()) {
    const result = validateTradeDraft(draft, {
      ...context,
      priorTrades,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      priorTrades.push(
        createTradeFromDraft(result.value, `sample-${index + 1}`),
      );
    }
  }
});

test("does not apply an oversell check to buy trades", () => {
  expect(validateTradeDraft(validDraft, context).ok).toBe(true);
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
  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "10"), {
      ...context,
      priorTrades: [createSimpleTrade("buy-ada", "buy", "ADA", "10")],
    }).ok,
  ).toBe(true);
});

test("allows a partial sell after multiple buys", () => {
  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "12"), {
      ...context,
      priorTrades: [
        createSimpleTrade("buy-ada-1", "buy", "ADA", "5"),
        createSimpleTrade("buy-ada-2", "buy", "ADA", "10"),
      ],
    }).ok,
  ).toBe(true);
});

test("uses the remaining holding after an earlier sell", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "6", "2026-04-02"),
  ];

  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "4"), {
      ...context,
      priorTrades,
    }).ok,
  ).toBe(true);
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

  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "6"), {
      ...context,
      priorTrades,
    }).ok,
  ).toBe(true);
});

test("keeps input order stable for prior trades at the same time", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "4", "2026-04-01"),
  ];

  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "6"), {
      ...context,
      priorTrades,
    }).ok,
  ).toBe(true);
});

test("does not let a future buy support an earlier candidate sell", () => {
  expectError(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "10", "2026-04-01"),
      {
        ...context,
        priorTrades: [
          createSimpleTrade("future-buy", "buy", "ADA", "10", "2026-04-10"),
        ],
      },
    ),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("rejects a backfilled sell that makes a later accepted sell oversell", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "10", "2026-04-03"),
  ];

  expectError(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "5", "2026-04-02"),
      { ...context, priorTrades },
    ),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("accepts a backfilled sell when the complete timeline stays non-negative", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    createSimpleTrade("sell-ada", "sell", "ADA", "3", "2026-04-03"),
  ];

  expect(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "5", "2026-04-02"),
      { ...context, priorTrades },
    ).ok,
  ).toBe(true);
});

test("runs an appended candidate after existing trades at the same time", () => {
  const occurredAt = "2026-04-01";

  expect(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "10", occurredAt),
      {
        ...context,
        priorTrades: [
          createSimpleTrade("buy-ada", "buy", "ADA", "10", occurredAt),
        ],
      },
    ).ok,
  ).toBe(true);
});

test("rejects an appended sell after existing same-time trades close the position", () => {
  const occurredAt = "2026-04-01";
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", occurredAt),
    createSimpleTrade("sell-ada", "sell", "ADA", "10", occurredAt),
  ];

  expectError(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "1", occurredAt),
      { ...context, priorTrades },
    ),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("does not mutate prior trades while sorting the complete timeline", () => {
  const firstTrade = createSimpleTrade(
    "sell-ada",
    "sell",
    "ADA",
    "4",
    "2026-04-02",
  );
  const secondTrade = createSimpleTrade(
    "buy-ada",
    "buy",
    "ADA",
    "10",
    "2026-04-01",
  );
  const priorTrades = [firstTrade, secondTrade];
  const snapshot = structuredClone(priorTrades);

  deepFreeze(priorTrades);

  expect(
    validateTradeDraft(
      createSimpleDraft("sell", "ADA", "6", "2026-04-03"),
      { ...context, priorTrades },
    ).ok,
  ).toBe(true);
  expect(priorTrades).toEqual(snapshot);
  expect(priorTrades[0]).toBe(firstTrade);
  expect(priorTrades[1]).toBe(secondTrade);
});

test("rejects a candidate currency that differs from the asset quote currency", () => {
  const input = { ...validDraft, currency: "CNY" };

  expectError(
    validateTradeDraft(input, context),
    TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
    "currency",
  );
  expect(input.currency).toBe("CNY");
});

test("rejects a candidate currency that differs from an existing same-asset trade", () => {
  const priorTrade = {
    ...createSimpleTrade("buy-btc", "buy", "BTC", "1"),
    currency: "CNY",
  } as unknown as Trade;

  expectError(
    validateTradeDraft(validDraft, {
      ...context,
      priorTrades: [priorTrade],
    }),
    TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
    "currency",
  );
});

test("ignores another asset that uses a different currency", () => {
  const otherAssetTrade = {
    ...createSimpleTrade("buy-ada", "buy", "ADA", "10"),
    currency: "CNY",
  } as unknown as Trade;

  expect(
    validateTradeDraft(validDraft, {
      ...context,
      priorTrades: [otherAssetTrade],
    }).ok,
  ).toBe(true);
});

test("accepts the asset quote currency when same-asset trades match", () => {
  expect(
    validateTradeDraft(validDraft, {
      ...context,
      priorTrades: [createSimpleTrade("buy-btc", "buy", "BTC", "1")],
    }).ok,
  ).toBe(true);
});

test("accepts a total value difference within the default tolerance", () => {
  expect(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.991",
      },
      context,
    ).ok,
  ).toBe(true);
});

test("accepts a total value difference exactly at the tolerance boundary", () => {
  expect(
    validateTradeDraft(
      {
        ...validDraft,
        quantity: "1",
        price: "10",
        totalValue: "9.99",
      },
      context,
    ).ok,
  ).toBe(true);
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

  expect(result.ok).toBe(false);
  if (!result.ok) {
    const mismatch = result.errors.find(
      (error) =>
        error.code === TRADE_VALIDATION_ERROR_CODES.TOTAL_VALUE_MISMATCH,
    );

    expect(mismatch).toBeDefined();
    expect(mismatch?.message).toMatch(/10/);
    expect(mismatch?.message).toMatch(/9\.5/);
    expect(mismatch?.message).toMatch(/0\.01/);
  }
});

test("supports a caller-provided total value tolerance", () => {
  expect(
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
  ).toBe(true);
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

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.fee).toBe("0");
  }
});

test("preserves an optional exact platform and fee rule source", () => {
  const result = validateTradeDraft(
    { ...validDraft, platform: "OKX", feeRuleId: "rule-okx-btc-v1" },
    context,
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.platform).toBe("OKX");
    expect(result.value.feeRuleId).toBe("rule-okx-btc-v1");
  }
});

test("rejects blank or surrounding-whitespace platform and fee rule facts", () => {
  for (const [field, value] of [
    ["platform", " OKX "],
    ["platform", ""],
    ["feeRuleId", " rule-1"],
    ["feeRuleId", ""],
  ] as const) {
    expectError(
      validateTradeDraft({ ...validDraft, [field]: value }, context),
      TRADE_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field,
    );
  }
});

test("keeps a foreign-fee fact readable when fee matching is not requested", () => {
  const result = validateTradeDraft(
    { ...validDraft, fee: "1", feeCurrency: "CNY" },
    context,
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.currency).toBe("USDT");
    expect(result.value.feeCurrency).toBe("CNY");
  }
});

test("enforces USDT for all V3 writes and matching non-zero fees when requested", () => {
  expectError(
    validateTradeDraft({ ...validDraft, currency: "USD" }, strictContext),
    TRADE_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
    "currency",
  );

  const usdtDraft = {
    ...validDraft,
    fee: "1",
    feeCurrency: "CNY",
  };
  expectError(
    validateTradeDraft(usdtDraft, strictContext),
    TRADE_VALIDATION_ERROR_CODES.FEE_CURRENCY_MISMATCH,
    "feeCurrency",
  );
  expect(
    validateTradeDraft(
      { ...usdtDraft, feeCurrency: "USDT" },
      strictContext,
    ).ok,
  ).toBe(true);
  expect(
    validateTradeDraft(
      { ...usdtDraft, fee: "0" },
      strictContext,
    ).ok,
  ).toBe(true);
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

test("requires a same-asset buy fee to be smaller than quantity", () => {
  for (const fee of ["1", "1.1"]) {
    expectError(
      validateTradeDraft(
        {
          ...createSimpleDraft("buy", "BTC", "1"),
          fee,
          feeCurrency: "BTC",
        },
        strictContext,
      ),
      TRADE_VALIDATION_ERROR_CODES.ASSET_FEE_MUST_BE_LESS_THAN_QUANTITY,
      "fee",
    );
  }

  expect(
    validateTradeDraft(
      {
        ...createSimpleDraft("buy", "BTC", "1"),
        fee: "0.1",
        feeCurrency: "BTC",
      },
      strictContext,
    ).ok,
  ).toBe(true);
});

test("uses net buy quantity in the complete holdings timeline", () => {
  const priorBuy = {
    ...createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
    fee: "1",
    feeCurrency: "ADA",
  };

  expect(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "9"), {
      ...context,
      priorTrades: [priorBuy],
    }).ok,
  ).toBe(true);
  expectError(
    validateTradeDraft(createSimpleDraft("sell", "ADA", "9.1"), {
      ...context,
      priorTrades: [priorBuy],
    }),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
  );
});

test("requires holdings for sell quantity plus its same-asset fee", () => {
  const priorTrades = [
    createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
  ];

  expect(
    validateTradeDraft(
      {
        ...createSimpleDraft("sell", "ADA", "9.5", "2026-04-02"),
        fee: "0.5",
        feeCurrency: "ADA",
      },
      { ...context, priorTrades },
    ).ok,
  ).toBe(true);
  expectError(
    validateTradeDraft(
      {
        ...createSimpleDraft("sell", "ADA", "9.6", "2026-04-02"),
        fee: "0.5",
        feeCurrency: "ADA",
      },
      { ...context, priorTrades },
    ),
    TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
    "quantity",
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

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toHaveLength(4);
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

  expect(result.ok).toBe(false);
  expect(calculatorCalls).toBe(0);
  expect(calculatePositions(priorTrades)).toEqual(positionsBefore);
  expect(priorTrades).toHaveLength(1);
});

function createSimpleDraft(
  type: "buy" | "sell",
  assetSymbol: string,
  quantity: string,
  occurredAt = "2026-09-01",
): TradeDraft {
  return {
    ...validDraft,
    occurredAt,
    type,
    assetSymbol,
    quantity,
    price: "1",
    totalValue: quantity,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
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
  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(
      result.errors.some(
        (error) => error.code === code && error.field === field,
      ),
      `Expected ${code} for ${field}`,
    ).toBe(true);
  }
}
