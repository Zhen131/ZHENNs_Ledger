import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "../backupEnvelope";
import { preflightBackupJson } from "../backupImportPreflight";

const TODAY = "2026-07-31";

describe("preflightBackupJson with a second-precision zone offset", () => {
  it("reports a hard error instead of throwing", async () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      {
        id: "trade-new-york",
        occurredAt: "2026-07-14T12:00:00-04:00",
        occurredTimeZone: "America/New_York",
        timePrecision: "minute",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "10",
        totalValue: "10",
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
        createdAt: "2026-07-14T16:00:00.000Z",
        updatedAt: "2026-07-14T16:00:00.000Z",
      },
    ];
    const envelope = createBackupEnvelope(
      ledger,
      { appVersion: "0.1.0", exportedAt: "2026-07-14T16:30:00.000Z" },
      TODAY,
    );
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const serialized = serializeBackupEnvelope(envelope.value).replace(
      "2026-07-14T12:00:00-04:00",
      "1850-06-01T12:00:00-05:00",
    );
    expect(serialized).toContain("1850-06-01T12:00:00-05:00");

    const result = await preflightBackupJson(serialized, {
      todayKey: TODAY,
      selectionGeneration: 1,
    });

    expect(result.hardErrorCount).toBeGreaterThan(0);
    expect(result.candidate).toBeUndefined();
  });
});
