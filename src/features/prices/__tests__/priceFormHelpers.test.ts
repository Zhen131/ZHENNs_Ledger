import { describe, expect, it } from "vitest";

import type { PriceSnapshotValidationError } from "@/core/validation";
import { translate, type TranslationKey } from "@/ui";
import { formatValidationError } from "../priceFormHelpers";

const assetInvalidInput: PriceSnapshotValidationError = {
  code: "PRICE_SNAPSHOT_INVALID_INPUT",
  field: "assetSymbol",
  message: "assetSymbol must be a non-empty string",
};

describe("price form formatValidationError", () => {
  it("spells the Chinese asset invalid-input sentence word for word", () => {
    expect(
      formatValidationError(assetInvalidInput, (key: TranslationKey) =>
        translate("zh-CN", key),
      ),
    ).toBe("资产不能为空或格式不正确");
  });

  it("spells the English asset invalid-input sentence word for word", () => {
    expect(
      formatValidationError(assetInvalidInput, (key: TranslationKey) =>
        translate("en", key),
      ),
    ).toBe("Asset cannot be empty or badly formatted");
  });
});
