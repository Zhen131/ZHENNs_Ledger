import { describe, expect, it } from "vitest";
import { createInitialLedgerData } from "@/core/state";
import { TRADE_VALIDATION_ERROR_CODES } from "@/core/validation";
import { createValidatedTrade } from "./tradeService";
import {
  validBuy,
  btcSell,
  externalIn,
  createDependencies,
} from "./tradeService.testHelpers";

describe("createValidatedTrade V4 transfer integration", () => {
  it("accepts a sell supported by an earlier external-in transfer", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [externalIn("supporting-transfer", "exchange")];
    const dependencies = createDependencies(["supported-sell"]);

    const result = createValidatedTrade(
      btcSell("6"),
      ledgerData,
      dependencies,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trade.id).toBe("supported-sell");
    expect(dependencies.generateId).toHaveBeenCalledOnce();
    expect(dependencies.now).toHaveBeenCalledOnce();
  });

  it("T1-08 rejects a sell supported only outside exchange", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      externalIn("cold-wallet-transfer", "cold-wallet"),
    ];
    const dependencies = createDependencies(["unused"]);

    const result = createValidatedTrade(
      btcSell("1"),
      ledgerData,
      dependencies,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "validation") {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
            field: "quantity",
          }),
        ]),
      );
    }
    expect(dependencies.generateId).not.toHaveBeenCalled();
    expect(dependencies.now).not.toHaveBeenCalled();
  });

  it("treats an asset-transfer ID as a global ID collision", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [externalIn("transfer-collision", "exchange")];
    const dependencies = createDependencies([
      "transfer-collision",
      "trade-unique",
    ]);

    const result = createValidatedTrade(validBuy, ledgerData, dependencies);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trade.id).toBe("trade-unique");
    expect(dependencies.generateId).toHaveBeenCalledTimes(2);
  });
});
