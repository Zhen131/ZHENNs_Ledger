import { describe, expect, it, vi } from "vitest";

import type {
  AssetTransfer,
  AssetTransferCategory,
  LedgerData,
  Trade,
} from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  createValidatedAssetTransfer,
  validateAssetTransferRemoval,
} from "./assetTransferService";
import {
  ASSET_TRANSFER_SERVICE_ERROR_CODES,
  type AssetTransferServiceDependencies,
} from "./assetTransferServiceContract";

const NOW = "2026-08-18T08:00:00.000Z";

describe("createValidatedAssetTransfer", () => {
  it.each([
    {
      category: "internal",
      reason: "internal-move",
      fromLocation: "exchange",
      toLocation: "cold-wallet",
      networkFee: "0.1",
      absent: ["unitPrice"],
    },
    {
      category: "external-in",
      reason: "deposit",
      toLocation: "cold-wallet",
      unitPrice: "4",
      absent: ["fromLocation", "networkFee"],
    },
    {
      category: "external-out",
      reason: "withdrawal",
      fromLocation: "exchange",
      networkFee: "0.1",
      absent: ["toLocation", "unitPrice"],
    },
    {
      category: "gain",
      reason: "airdrop",
      toLocation: "cold-wallet-earn",
      unitPrice: "4",
      absent: ["fromLocation", "networkFee"],
    },
  ] as const)(
    "creates $category and truly omits every inapplicable field",
    ({ absent, ...specific }) => {
      const ledgerData = ledgerWithExchangeHolding("10");
      const result = createValidatedAssetTransfer(
        {
          ...validDraftFor(specific.category),
          ...specific,
          note: "  fictional transfer  ",
        },
        ledgerData,
        dependencies([`transfer-${specific.category}`]),
      );

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.assetTransfer).toMatchObject({
        id: `transfer-${specific.category}`,
        ...specific,
        quantity: "2",
        note: "fictional transfer",
      });
      for (const key of absent) {
        expect(result.assetTransfer).not.toHaveProperty(key);
      }
    },
  );

  it.each([
    ["internal", "deposit"],
    ["external-in", "withdrawal"],
    ["external-out", "internal-move"],
    ["gain", "deposit"],
  ] as const)("rejects reason %s/%s mismatch", (category, reason) => {
    const result = createValidatedAssetTransfer(
      validDraftFor(category, { reason }),
      ledgerWithExchangeHolding("10"),
      dependencies(["unused"]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_REASON,
        field: "reason",
      },
    });
  });

  it.each([
    ["internal", { fromLocation: undefined }, "fromLocation"],
    ["internal", { toLocation: undefined }, "toLocation"],
    ["internal", { toLocation: "exchange" }, "toLocation"],
    ["internal", { unitPrice: "2" }, "unitPrice"],
    ["external-in", { fromLocation: "exchange" }, "fromLocation"],
    ["external-in", { toLocation: undefined }, "toLocation"],
    ["external-in", { unitPrice: undefined }, "unitPrice"],
    ["external-in", { networkFee: "0.1" }, "networkFee"],
    ["external-out", { fromLocation: undefined }, "fromLocation"],
    ["external-out", { toLocation: "cold-wallet" }, "toLocation"],
    ["external-out", { unitPrice: "2" }, "unitPrice"],
    ["gain", { fromLocation: "exchange" }, "fromLocation"],
    ["gain", { toLocation: undefined }, "toLocation"],
    ["gain", { unitPrice: undefined }, "unitPrice"],
    ["gain", { networkFee: "0.1" }, "networkFee"],
  ] as const)(
    "rejects invalid %s combination at %s",
    (category, override, field) => {
      const result = createValidatedAssetTransfer(
        validDraftFor(category, override),
        ledgerWithExchangeHolding("10"),
        dependencies(["unused"]),
      );

      expect(result).toMatchObject({ ok: false, error: { field } });
    },
  );

  it.each([
    ["0", "quantity", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_QUANTITY],
    ["01", "quantity", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_QUANTITY],
    ["1e3", "quantity", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_QUANTITY],
    ["1.0000000000000000000", "quantity", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_QUANTITY],
    ["12345678901234567890123456789012345678901", "quantity", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_QUANTITY],
    ["0", "unitPrice", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_UNIT_PRICE],
    ["0", "networkFee", ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_NETWORK_FEE],
  ] as const)(
    "rejects non-canonical or non-positive %s in %s",
    (value, field, code) => {
      const category = field === "networkFee" ? "internal" : "external-in";
      const result = createValidatedAssetTransfer(
        validDraftFor(category, { [field]: value }),
        ledgerWithExchangeHolding("10"),
        dependencies(["unused"]),
      );

      expect(result).toMatchObject({ ok: false, error: { code, field } });
    },
  );

  it("accepts exactly 40 significant digits and 18 decimal places", () => {
    const result = createValidatedAssetTransfer(
      validDraftFor("external-in", {
        quantity: "1234567890123456789012.123456789012345678",
      }),
      createInitialLedgerData(),
      dependencies(["decimal-boundary"]),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects non-text and overlong notes at the note field", () => {
    for (const [note, code] of [
      [7, ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_NOTE],
      ["x".repeat(4_097), ASSET_TRANSFER_SERVICE_ERROR_CODES.NOTE_TOO_LONG],
    ] as const) {
      expect(
        createValidatedAssetTransfer(
          validDraftFor("external-in", { note }),
          createInitialLedgerData(),
          dependencies(["unused"]),
        ),
      ).toMatchObject({ ok: false, error: { code, field: "note" } });
    }
  });

  it("rejects invalid, future, and unknown-asset facts before ID generation", () => {
    const cases = [
      [
        { occurredAt: "2026-02-30" },
        ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_DATE,
        "occurredAt",
      ],
      [
        { occurredAt: "2026-08-19" },
        ASSET_TRANSFER_SERVICE_ERROR_CODES.FUTURE_FACT,
        "occurredAt",
      ],
      [
        { assetSymbol: "FAKE" },
        ASSET_TRANSFER_SERVICE_ERROR_CODES.INVALID_ASSET,
        "assetSymbol",
      ],
    ] as const;

    for (const [override, code, field] of cases) {
      const deps = dependencies(["unused"]);
      const result = createValidatedAssetTransfer(
        validDraftFor("external-in", override),
        createInitialLedgerData(),
        deps,
      );
      expect(result).toMatchObject({ ok: false, error: { code, field } });
      expect(deps.generateId).not.toHaveBeenCalled();
      expect(deps.now).not.toHaveBeenCalled();
    }
  });

  it("rejects quantity plus fee above total holding or source location", () => {
    const aboveTotal = createValidatedAssetTransfer(
      validDraftFor("external-out", { quantity: "5", networkFee: "1" }),
      ledgerWithExchangeHolding("5"),
      dependencies(["above-total"]),
    );
    expect(aboveTotal).toMatchObject({
      ok: false,
      error: {
        code: ASSET_TRANSFER_SERVICE_ERROR_CODES.INSUFFICIENT_HOLDING,
        field: "quantity",
      },
    });

    const ledgerData = ledgerWithExchangeHolding("5");
    ledgerData.assetTransfers = [
      transfer("move-four", {
        category: "internal",
        reason: "internal-move",
        quantity: "4",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
      }),
    ];
    const aboveSource = createValidatedAssetTransfer(
      validDraftFor("external-out", {
        occurredAt: "2026-08-03",
        quantity: "4",
        networkFee: "1",
        fromLocation: "cold-wallet",
      }),
      ledgerData,
      dependencies(["above-source"]),
    );
    expect(aboveSource).toMatchObject({
      ok: false,
      error: {
        code: ASSET_TRANSFER_SERVICE_ERROR_CODES.INSUFFICIENT_HOLDING,
      },
    });
  });

  it("retries globally colliding IDs and succeeds only with the third unique ID", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      transfer("taken-transfer", {
        category: "external-in",
        reason: "deposit",
        quantity: "1",
        unitPrice: "2",
        toLocation: "exchange",
      }),
    ];
    const deps = dependencies([
      ledgerData.assets[0].id,
      "taken-transfer",
      "unique-transfer",
    ]);
    const result = createValidatedAssetTransfer(
      validDraftFor("external-in"),
      ledgerData,
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assetTransfer.id).toBe("unique-transfer");
    expect(deps.generateId).toHaveBeenCalledTimes(3);
  });

  it("rejects deleting a transfer that supports a later outbound fact", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      transfer("supporting-in", {
        category: "external-in",
        reason: "deposit",
        quantity: "5",
        unitPrice: "10",
        toLocation: "exchange",
      }),
      {
        ...transfer("dependent-out", {
          category: "external-out",
          reason: "withdrawal",
          quantity: "5",
          fromLocation: "exchange",
        }),
        occurredAt: "2026-08-03",
        createdAt: "2026-08-03T08:00:00.000Z",
        updatedAt: "2026-08-03T08:00:00.000Z",
      },
    ];

    expect(validateAssetTransferRemoval("supporting-in", ledgerData)).toMatchObject({
      ok: false,
      error: {
        code: ASSET_TRANSFER_SERVICE_ERROR_CODES.REMOVAL_BREAKS_TIMELINE,
        field: "form",
      },
    });
    expect(validateAssetTransferRemoval("missing", ledgerData)).toMatchObject({
      ok: false,
      error: { code: ASSET_TRANSFER_SERVICE_ERROR_CODES.TRANSFER_NOT_FOUND },
    });
  });
});

function validDraftFor(
  category: AssetTransferCategory,
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  const byCategory: Record<AssetTransferCategory, Record<string, unknown>> = {
    internal: {
      reason: "internal-move",
      fromLocation: "exchange",
      toLocation: "cold-wallet",
    },
    "external-in": {
      reason: "deposit",
      unitPrice: "4",
      toLocation: "exchange",
    },
    "external-out": {
      reason: "withdrawal",
      fromLocation: "exchange",
    },
    gain: {
      reason: "airdrop",
      unitPrice: "4",
      toLocation: "cold-wallet-earn",
    },
  };
  return {
    category,
    assetSymbol: "BTC",
    quantity: "2",
    occurredAt: "2026-08-18",
    ...byCategory[category],
    ...override,
  };
}

function ledgerWithExchangeHolding(quantity: string): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [buy("supporting-buy", quantity)];
  return ledgerData;
}

function buy(id: string, quantity: string): Trade {
  return {
    id,
    occurredAt: "2026-08-01",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity,
    price: "10",
    totalValue: `${Number(quantity) * 10}`,
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
  };
}

function transfer(
  id: string,
  value: Pick<
    AssetTransfer,
    | "category"
    | "reason"
    | "quantity"
    | "fromLocation"
    | "toLocation"
    | "unitPrice"
    | "networkFee"
  >,
): AssetTransfer {
  return {
    id,
    occurredAt: "2026-08-02",
    timePrecision: "day",
    assetSymbol: "BTC",
    ...value,
    createdAt: "2026-08-02T08:00:00.000Z",
    updatedAt: "2026-08-02T08:00:00.000Z",
  };
}

function dependencies(ids: string[]): AssetTransferServiceDependencies & {
  generateId: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  todayKey: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  return {
    generateId: vi.fn(() => ids[index++] ?? "unexpected"),
    now: vi.fn(() => NOW),
    todayKey: vi.fn(() => "2026-08-18"),
  };
}
