import { describe, expect, it } from "vitest";
import { replayPositions } from "./positionReplay";
import { trade, baseBuy, transfer } from "./positionReplay.testHelpers";

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
