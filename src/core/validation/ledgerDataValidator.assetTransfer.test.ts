import { describe, expect, it } from "vitest";
import { createInitialLedgerData } from "@/core/state";
import { validateLedgerData } from "./ledgerDataValidator";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
} from "./ledgerDataValidatorSchema";
import {
  expectError,
  transferForCategory,
  withoutTransferField,
  ledgerWithTransfer,
} from "./ledgerDataValidator.testHelpers";

describe("V4 asset transfer validation contract", () => {
  it("accepts all four categories when their exact combinations form a valid timeline", () => {
    const ledger = createInitialLedgerData();
    ledger.assetTransfers = [
      {
        ...transferForCategory("external-in"),
        id: "external-in-valid",
        occurredAt: "2026-08-01",
        quantity: "100",
        unitPrice: "10",
        toLocation: "exchange",
      },
      {
        ...transferForCategory("internal"),
        id: "internal-valid",
        occurredAt: "2026-08-02",
        quantity: "20",
        networkFee: "1",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
      },
      {
        ...transferForCategory("gain"),
        id: "gain-valid",
        occurredAt: "2026-08-03",
        quantity: "5",
        unitPrice: "4",
        toLocation: "cold-wallet-earn",
      },
      {
        ...transferForCategory("external-out"),
        id: "external-out-valid",
        occurredAt: "2026-08-04",
        quantity: "10",
        networkFee: "1",
        fromLocation: "exchange",
      },
    ];

    const result = validateLedgerData(ledger);
    expect(result).toEqual({ ok: true, value: ledger });
  });

  it.each([
    {
      name: "internal requires fromLocation",
      input: withoutTransferField(
        transferForCategory("internal"),
        "fromLocation",
      ),
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "internal requires toLocation",
      input: withoutTransferField(
        transferForCategory("internal"),
        "toLocation",
      ),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "internal locations must differ",
      input: {
        ...transferForCategory("internal"),
        toLocation: "exchange",
      },
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "internal forbids unitPrice",
      input: { ...transferForCategory("internal"), unitPrice: "1" },
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "internal networkFee must be positive when present",
      input: { ...transferForCategory("internal"), networkFee: "0" },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "external-in forbids fromLocation",
      input: {
        ...transferForCategory("external-in"),
        fromLocation: "exchange",
      },
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "external-in requires toLocation",
      input: withoutTransferField(
        transferForCategory("external-in"),
        "toLocation",
      ),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "external-in requires unitPrice",
      input: withoutTransferField(
        transferForCategory("external-in"),
        "unitPrice",
      ),
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "external-in forbids networkFee",
      input: {
        ...transferForCategory("external-in"),
        networkFee: "0.1",
      },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "external-out requires fromLocation",
      input: withoutTransferField(
        transferForCategory("external-out"),
        "fromLocation",
      ),
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "external-out forbids toLocation",
      input: {
        ...transferForCategory("external-out"),
        toLocation: "cold-wallet",
      },
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "external-out forbids unitPrice",
      input: { ...transferForCategory("external-out"), unitPrice: "1" },
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "external-out networkFee must be positive when present",
      input: { ...transferForCategory("external-out"), networkFee: "0" },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "gain forbids fromLocation",
      input: {
        ...transferForCategory("gain"),
        fromLocation: "exchange",
      },
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "gain requires toLocation",
      input: withoutTransferField(transferForCategory("gain"), "toLocation"),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "gain requires unitPrice",
      input: withoutTransferField(transferForCategory("gain"), "unitPrice"),
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "gain forbids networkFee",
      input: { ...transferForCategory("gain"), networkFee: "0.1" },
      path: "assetTransfers[0].networkFee",
    },
  ])("T1-09 rejects $name", ({ input, path }) => {
    expectError(
      ledgerWithTransfer(input),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
    );
  });

  it.each([
    ["deposit", "gain"],
    ["withdrawal", "gain"],
    ["internal-move", "gain"],
    ["airdrop", "external-in"],
    ["interest", "external-in"],
    ["platform-gift", "external-in"],
  ] as const)(
    "T1-09 rejects reason %s on category %s",
    (reason, category) => {
      expectError(
        ledgerWithTransfer({
          ...transferForCategory(category),
          reason,
        }),
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        "assetTransfers[0].reason",
      );
    },
  );

  it("rejects unknown keys, assets, decimal bounds, and cross-collection IDs", () => {
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        unexpected: true,
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].unexpected",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        assetSymbol: "DOGE",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
      "assetTransfers[0].assetSymbol",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        quantity: "12345678901234567890123456789012345678901",
        unitPrice: "1.1234567890123456789",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].quantity",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        quantity: "1",
        unitPrice: "1.1234567890123456789",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].unitPrice",
    );

    const duplicateLedger = createInitialLedgerData();
    duplicateLedger.assetTransfers = [
      {
        ...transferForCategory("external-in"),
        id: duplicateLedger.assets[0].id,
      },
    ];
    expectError(
      duplicateLedger,
      LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
      "assetTransfers[0].id",
    );
  });
});
