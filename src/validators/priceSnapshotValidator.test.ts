import { describe, expect, it } from "vitest";

import type { PriceSnapshotDraft } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  PRICE_SNAPSHOT_VALIDATION_ERROR_CODES,
  validatePriceSnapshotDraft,
} from "./priceSnapshotValidator";

const assets = createInitialLedgerData().assets;
const validDraft: PriceSnapshotDraft = {
  assetSymbol: "BTC",
  price: "70000",
  currency: "USD",
  recordedAt: "2026-07-16",
  source: "manual",
};

describe("validatePriceSnapshotDraft", () => {
  it("accepts and normalizes a valid manual price", () => {
    expect(
      validatePriceSnapshotDraft(
        { ...validDraft, note: "manual close", id: "forged" },
        assets,
      ),
    ).toEqual({
      ok: true,
      value: { ...validDraft, note: "manual close" },
    });
  });

  it("accepts a valid ISO datetime with a timezone", () => {
    expect(
      validatePriceSnapshotDraft(
        {
          ...validDraft,
          recordedAt: "2026-07-16T12:30:45.123+08:00",
        },
        assets,
      ).ok,
    ).toBe(true);
  });

  it.each([
    {
      input: "not-an-object",
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field: "input",
    },
    {
      input: { ...validDraft, assetSymbol: "DOGE" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.ASSET_NOT_FOUND,
      field: "assetSymbol",
    },
    {
      input: { ...validDraft, price: "invalid" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
      field: "price",
    },
    {
      input: { ...validDraft, price: "0" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.VALUE_MUST_BE_POSITIVE,
      field: "price",
    },
    {
      input: { ...validDraft, currency: "CNY" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
      field: "currency",
    },
    {
      input: { ...validDraft, source: "import" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SOURCE,
      field: "source",
    },
    {
      input: { ...validDraft, recordedAt: "2026-02-30" },
      code: PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
      field: "recordedAt",
    },
  ])("rejects invalid runtime input for $field", ({ input, code, field }) => {
    const result = validatePriceSnapshotDraft(input, assets);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code, field })]),
      );
    }
  });
});
