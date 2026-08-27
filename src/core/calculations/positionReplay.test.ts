import { describe, expect, it } from "vitest";

import type { AssetTransfer, Trade } from "@/core/models";
import { replayPositions } from "./positionReplay";

const TIMESTAMP = "2026-08-09T00:00:00Z";

function trade(
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
    | "fee"
  > &
    Partial<Pick<Trade, "feeCurrency" | "feeRuleId">>,
): Trade {
  return {
    timePrecision: "day",
    assetSymbol: "BTC",
    currency: "USDT",
    feeCurrency: overrides.feeCurrency ?? "USDT",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe("fee-aware position replay", () => {
  it("matches the fixed 6500/5 and 2800/3 accounting example exactly", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "0.1",
        price: "65000",
        totalValue: "6500",
        fee: "5",
      }),
      trade({
        id: "sell",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "0.04",
        price: "70000",
        totalValue: "2800",
        fee: "3",
      }),
    ]);

    expect(positions).toEqual([
      expect.objectContaining({
        assetSymbol: "BTC",
        quantity: "0.06",
        averageCost: "65050",
        costBasis: "3903",
        realizedPnl: "195",
        currency: "USDT",
      }),
    ]);
  });

  it("includes every buy fee, removes average fee-aware cost, and deducts sell fees", () => {
    const positions = replayPositions([
      trade({
        id: "buy-1",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "1",
      }),
      trade({
        id: "buy-2",
        occurredAt: "2026-08-02",
        type: "buy",
        quantity: "1",
        price: "200",
        totalValue: "200",
        fee: "2",
      }),
      trade({
        id: "sell",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "0.5",
        price: "200",
        totalValue: "100",
        fee: "1",
      }),
    ]);

    expect(positions[0]).toEqual(
      expect.objectContaining({
        quantity: "1.5",
        averageCost: "151.5",
        costBasis: "227.25",
        realizedPnl: "23.25",
      }),
    );
  });

  it("removes the entire remaining cost on the final sell without a decimal residue", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "0.3",
        price: "0.3333333333333333333333333333333333333333",
        totalValue: "0.1",
        fee: "0.0000000000000000000000000000000000000001",
      }),
      trade({
        id: "partial",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "0.1",
        price: "0.5",
        totalValue: "0.05",
        fee: "0.0000000000000000000000000000000000000001",
      }),
      trade({
        id: "final",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "0.2",
        price: "0.5",
        totalValue: "0.1",
        fee: "0",
      }),
    ]);

    expect(positions[0].quantity).toBe("0");
    expect(positions[0].averageCost).toBe("0");
    expect(positions[0].costBasis).toBe("0");
  });

  it("keeps zero-fee behavior unchanged and never consults fee rules", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "0",
        feeCurrency: "BNB",
        feeRuleId: "ignored-rule",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "1",
      locationQuantities: {
        exchange: "1",
        "cold-wallet": "0",
        "cold-wallet-earn": "0",
      },
      averageCost: "100",
      costBasis: "100",
      realizedPnl: "0",
      giftIncome: "0",
      currency: "USDT",
    });
  });

  it("adds only the net acquired quantity when a buy fee uses the traded asset", () => {
    const positions = replayPositions([
      trade({
        id: "asset-fee-buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "10",
        price: "10",
        totalValue: "100",
        fee: "1",
        feeCurrency: "BTC",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "9",
      locationQuantities: {
        exchange: "9",
        "cold-wallet": "0",
        "cold-wallet-earn": "0",
      },
      averageCost: "11.11111111111111111111111111111111111111",
      costBasis: "100",
      realizedPnl: "0",
      giftIncome: "0",
      currency: "USDT",
    });
  });

  it("consumes sold quantity plus a same-asset sell fee and realizes that cost", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "10",
        price: "10",
        totalValue: "100",
        fee: "0",
      }),
      trade({
        id: "asset-fee-sell",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "4",
        price: "15",
        totalValue: "60",
        fee: "0.5",
        feeCurrency: "BTC",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "5.5",
      locationQuantities: {
        exchange: "5.5",
        "cold-wallet": "0",
        "cold-wallet-earn": "0",
      },
      averageCost: "10",
      costBasis: "55",
      realizedPnl: "15",
      giftIncome: "0",
      currency: "USDT",
    });
  });

  it("allows a same-asset fee to consume the exact final holding", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "10",
        price: "10",
        totalValue: "100",
        fee: "0",
      }),
      trade({
        id: "final-sell",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "9.5",
        price: "20",
        totalValue: "190",
        fee: "0.5",
        feeCurrency: "BTC",
      }),
    ]);

    expect(positions[0]).toEqual(
      expect.objectContaining({
        quantity: "0",
        averageCost: "0",
        costBasis: "0",
        realizedPnl: "90",
      }),
    );
  });

  it("rejects a buy whose same-asset fee leaves no acquired quantity", () => {
    expect(() =>
      replayPositions([
        trade({
          id: "invalid-buy",
          occurredAt: "2026-08-01",
          type: "buy",
          quantity: "1",
          price: "10",
          totalValue: "10",
          fee: "1",
          feeCurrency: "BTC",
        }),
      ]),
    ).toThrow(/buy fee must be less than/);
  });

  it("rejects a sell when quantity plus its same-asset fee exceeds holdings", () => {
    expect(() =>
      replayPositions([
        trade({
          id: "buy",
          occurredAt: "2026-08-01",
          type: "buy",
          quantity: "10",
          price: "10",
          totalValue: "100",
          fee: "0",
        }),
        trade({
          id: "oversell",
          occurredAt: "2026-08-02",
          type: "sell",
          quantity: "9.8",
          price: "20",
          totalValue: "196",
          fee: "0.3",
          feeCurrency: "BTC",
        }),
      ]),
    ).toThrow(/Cannot sell more BTC/);
  });

  it("records a foreign non-zero fee issue without guessing a conversion", () => {
    const positions = replayPositions([
      trade({
        id: "foreign-fee",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "0.01",
        feeCurrency: "BNB",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "1",
      locationQuantities: {
        exchange: "1",
        "cold-wallet": "0",
        "cold-wallet-earn": "0",
      },
      averageCost: "100",
      costBasis: "100",
      realizedPnl: "0",
      giftIncome: "0",
      currency: "USDT",
      feeAccountingIssues: [
        {
          code: "UNSUPPORTED_FEE_CURRENCY",
          tradeId: "foreign-fee",
          assetSymbol: "BTC",
          occurredAt: "2026-08-01",
          fee: "0.01",
          feeCurrency: "BNB",
          tradeCurrency: "USDT",
        },
      ],
    });
  });

  it("does not mutate trades while replaying", () => {
    const trades = [
      trade({
        id: "immutable",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "1",
      }),
    ];
    const before = structuredClone(trades);

    replayPositions(trades);

    expect(trades).toEqual(before);
  });
});

describe("V4 trade and asset-transfer replay contract", () => {
  it("T1-01 keeps total quantity and average cost byte-identical for a fee-free internal move", () => {
    const buy = baseBuy();
    const before = replayPositions([buy])[0];
    const after = replayPositions(
      [buy],
      [
        transfer({
          id: "move-no-fee",
          occurredAt: "2026-08-02",
          category: "internal",
          reason: "internal-move",
          quantity: "30",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        }),
      ],
    )[0];

    expect(after.quantity).toBe(before.quantity);
    expect(after.averageCost).toBe(before.averageCost);
    expect(after.costBasis).toBe(before.costBasis);
    expect(after.locationQuantities).toEqual({
      exchange: "70",
      "cold-wallet": "30",
      "cold-wallet-earn": "0",
    });
  });

  it("T1-02 charges an internal network fee in the asset itself", () => {
    const position = replayPositions(
      [baseBuy()],
      [
        transfer({
          id: "move-with-fee",
          occurredAt: "2026-08-02",
          category: "internal",
          reason: "internal-move",
          quantity: "20",
          networkFee: "2",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        }),
      ],
    )[0];

    expect(position).toEqual({
      assetSymbol: "BTC",
      quantity: "98",
      locationQuantities: {
        exchange: "78",
        "cold-wallet": "20",
        "cold-wallet-earn": "0",
      },
      averageCost: "10",
      costBasis: "980",
      realizedPnl: "-20",
      giftIncome: "0",
      currency: "USDT",
    });
  });

  it("T1-03 applies the fixed external-in cost example field by field", () => {
    const position = replayPositions(
      [baseBuy()],
      [
        transfer({
          id: "external-in",
          occurredAt: "2026-08-02",
          category: "external-in",
          reason: "deposit",
          quantity: "50",
          unitPrice: "4",
          toLocation: "cold-wallet",
        }),
      ],
    )[0];

    expect(position.quantity).toBe("150");
    expect(position.costBasis).toBe("1200");
    expect(position.averageCost).toBe("8");
    expect(position.realizedPnl).toBe("0");
    expect(position.giftIncome).toBe("0");
    expect(position.locationQuantities).toEqual({
      exchange: "100",
      "cold-wallet": "50",
      "cold-wallet-earn": "0",
    });
  });

  it("T1-04 converts external-out cost into a realized loss", () => {
    const position = replayPositions(
      [baseBuy()],
      [
        transfer({
          id: "external-out",
          occurredAt: "2026-08-02",
          category: "external-out",
          reason: "withdrawal",
          quantity: "20",
          fromLocation: "exchange",
        }),
      ],
    )[0];

    expect(position.quantity).toBe("80");
    expect(position.costBasis).toBe("800");
    expect(position.averageCost).toBe("10");
    expect(position.realizedPnl).toBe("-200");
    expect(position.locationQuantities.exchange).toBe("80");
  });

  it("T1-05 values gain quantity at arrival price instead of zero cost", () => {
    const position = replayPositions(
      [baseBuy()],
      [
        transfer({
          id: "gift",
          occurredAt: "2026-08-02",
          category: "gain",
          reason: "airdrop",
          quantity: "50",
          unitPrice: "4",
          toLocation: "cold-wallet-earn",
        }),
      ],
    )[0];

    expect(position.quantity).toBe("150");
    expect(position.costBasis).toBe("1200");
    expect(position.averageCost).toBe("8");
    expect(position.averageCost).not.toBe("6.6667");
    expect(position.giftIncome).toBe("200");
    expect(position.locationQuantities).toEqual({
      exchange: "100",
      "cold-wallet": "0",
      "cold-wallet-earn": "50",
    });
  });

  it.each([
    {
      label: "internal exceeds total",
      facts: [
        transfer({
          id: "internal-total",
          occurredAt: "2026-08-02",
          category: "internal",
          reason: "internal-move",
          quantity: "100",
          networkFee: "1",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        }),
      ],
      error: /more BTC than current position/,
    },
    {
      label: "internal exceeds source",
      facts: [
        transfer({
          id: "move-first",
          occurredAt: "2026-08-02",
          category: "internal",
          reason: "internal-move",
          quantity: "80",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        }),
        transfer({
          id: "internal-source",
          occurredAt: "2026-08-03",
          category: "internal",
          reason: "internal-move",
          quantity: "20",
          networkFee: "1",
          fromLocation: "exchange",
          toLocation: "cold-wallet-earn",
        }),
      ],
      error: /from exchange than available/,
    },
    {
      label: "external-out exceeds total",
      facts: [
        transfer({
          id: "external-total",
          occurredAt: "2026-08-02",
          category: "external-out",
          reason: "withdrawal",
          quantity: "100",
          networkFee: "1",
          fromLocation: "exchange",
        }),
      ],
      error: /more BTC than current position/,
    },
    {
      label: "external-out exceeds source",
      facts: [
        transfer({
          id: "move-first",
          occurredAt: "2026-08-02",
          category: "internal",
          reason: "internal-move",
          quantity: "80",
          fromLocation: "exchange",
          toLocation: "cold-wallet",
        }),
        transfer({
          id: "external-source",
          occurredAt: "2026-08-03",
          category: "external-out",
          reason: "withdrawal",
          quantity: "20",
          networkFee: "1",
          fromLocation: "exchange",
        }),
      ],
      error: /from exchange than available/,
    },
  ])("T1-07 rejects $label", ({ facts, error }) => {
    expect(() => replayPositions([baseBuy()], facts)).toThrow(error);
  });

  it("T1-08 rejects a sell when exchange is short although total holdings suffice", () => {
    const sell = trade({
      id: "sell-from-exchange",
      occurredAt: "2026-08-03",
      type: "sell",
      quantity: "50",
      price: "10",
      totalValue: "500",
      fee: "0",
    });
    const move = transfer({
      id: "move-to-cold",
      occurredAt: "2026-08-02",
      category: "internal",
      reason: "internal-move",
      quantity: "60",
      fromLocation: "exchange",
      toLocation: "cold-wallet",
    });

    expect(() => replayPositions([baseBuy(), sell], [move])).toThrow(
      /sell more BTC from exchange than available/,
    );
  });

  it("T1-11 is invariant when both source arrays are shuffled", () => {
    const trades = [
      trade({
        id: "trade-z-buy",
        occurredAt: "2026-08-01T08:00:00.000Z",
        type: "buy",
        quantity: "100",
        price: "10",
        totalValue: "1000",
        fee: "0",
      }),
      trade({
        id: "trade-sell",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "10",
        price: "12",
        totalValue: "120",
        fee: "0",
      }),
    ];
    const transfers = [
      transfer({
        id: "transfer-a",
        occurredAt: "2026-08-01T08:00:00.000Z",
        category: "internal",
        reason: "internal-move",
        quantity: "20",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
      }),
      transfer({
        id: "transfer-gain",
        occurredAt: "2026-08-02",
        category: "gain",
        reason: "interest",
        quantity: "5",
        unitPrice: "8",
        toLocation: "cold-wallet-earn",
      }),
    ];

    expect(
      replayPositions([...trades].reverse(), [...transfers].reverse()),
    ).toEqual(replayPositions(trades, transfers));
  });

  it("T1-12 always emits all three zero location keys after full consumption", () => {
    const finalSell = trade({
      id: "full-sell",
      occurredAt: "2026-08-02",
      type: "sell",
      quantity: "100",
      price: "11",
      totalValue: "1100",
      fee: "0",
    });
    const position = replayPositions([baseBuy(), finalSell])[0];

    expect(position.quantity).toBe("0");
    expect(position.locationQuantities).toEqual({
      exchange: "0",
      "cold-wallet": "0",
      "cold-wallet-earn": "0",
    });
    expect(Object.keys(position.locationQuantities)).toEqual([
      "exchange",
      "cold-wallet",
      "cold-wallet-earn",
    ]);

    const transferOnlyPosition = replayPositions(
      [],
      [
        transfer({
          id: "transfer-only-in",
          occurredAt: "2026-08-01",
          category: "external-in",
          reason: "deposit",
          quantity: "5",
          unitPrice: "2",
          toLocation: "cold-wallet",
        }),
        transfer({
          id: "transfer-only-out",
          occurredAt: "2026-08-02",
          category: "external-out",
          reason: "withdrawal",
          quantity: "5",
          fromLocation: "cold-wallet",
        }),
      ],
    )[0];
    expect(transferOnlyPosition.quantity).toBe("0");
    expect(transferOnlyPosition.locationQuantities).toEqual({
      exchange: "0",
      "cold-wallet": "0",
      "cold-wallet-earn": "0",
    });
  });
});

function baseBuy(): Trade {
  return trade({
    id: "base-buy",
    occurredAt: "2026-08-01",
    type: "buy",
    quantity: "100",
    price: "10",
    totalValue: "1000",
    fee: "0",
  });
}

function transfer(
  overrides: Pick<
    AssetTransfer,
    "id" | "occurredAt" | "category" | "reason" | "quantity"
  > &
    Partial<
      Pick<
        AssetTransfer,
        | "unitPrice"
        | "networkFee"
        | "fromLocation"
        | "toLocation"
        | "createdAt"
      >
    >,
): AssetTransfer {
  return {
    timePrecision: overrides.occurredAt.includes("T") ? "second" : "day",
    assetSymbol: "BTC",
    createdAt: overrides.createdAt ?? TIMESTAMP,
    updatedAt: overrides.createdAt ?? TIMESTAMP,
    ...overrides,
  };
}
