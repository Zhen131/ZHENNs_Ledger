import assert from "node:assert/strict";

import type { Asset, TradeDraft } from "../models";
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

const assets: Asset[] = [
  createAsset("BTC", "Bitcoin"),
  createAsset("ETH", "Ethereum"),
  createAsset("ADA", "Cardano"),
];

const validDraft: TradeDraft = {
  occurredAt: "2026-04-02",
  timePrecision: "day",
  type: "buy",
  assetSymbol: "BTC",
  quantity: "0.00016388",
  price: "67121.7",
  totalValue: "11",
  currency: "USD",
};

const sampleDrafts: TradeDraft[] = [
  validDraft,
  {
    ...validDraft,
    assetSymbol: "ETH",
    quantity: "0.004854",
    price: "2059.99",
    totalValue: "10",
  },
  {
    ...validDraft,
    assetSymbol: "ADA",
    quantity: "41.58",
    price: "0.2405",
    totalValue: "10",
  },
  {
    ...validDraft,
    occurredAt: "2026-04-09",
    assetSymbol: "ADA",
    quantity: "126.6825",
    price: "0.2526",
    totalValue: "32",
  },
  {
    ...validDraft,
    occurredAt: "2026-04-14",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "82.9381",
    price: "0.2412",
    totalValue: "20",
  },
];

const context = {
  assets,
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
  for (const draft of sampleDrafts) {
    assert.equal(validateTradeDraft(draft, context).ok, true);
  }
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

function createAsset(symbol: string, name: string): Asset {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    name,
    quoteCurrency: "USD",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
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
