import { describe, expect, it } from "vitest";

import { validateLedgerImportPolicy } from "@/core/policies";
import { createInitialLedgerData } from "@/core/state";
import {
  validateLedgerData,
  validatePriceSnapshotDraft,
  validateTradeDraft,
} from "@/core/validation";
import {
  formatBackupImportReportMarkdown,
  preflightBackupJson,
} from "@/features/backup";
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import {
  DEFAULT_LEDGER_LANGUAGE,
  translate,
  translateDefault,
} from "@/ui";

import { LEDGER_FILE_ACCESS_ERROR_CODES } from "@/app/file-access";
import { getFileAccessErrorMessage } from "./LedgerAccessGateHelpers";

/**
 * Interface wording that names the ledger schema version went stale once
 * already: the ledger moved to 5 and several sentences kept saying 4, with no
 * test to notice. Every such sentence is pinned here against the version's own
 * definition, so the next bump either carries the wording with it or turns one
 * of these red.
 */
const CURRENT = `V${SUPPORTED_LEDGER_SCHEMA_VERSION}`;
const t = translateDefault;

describe("interface wording that names the ledger schema version", () => {
  it("names the current version when a file carries an unsupported schema", () => {
    const message = getFileAccessErrorMessage(
      LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_LEDGER_SCHEMA,
      t,
    );

    expect(message).toBe(
      `该文件承载 V3、其他旧版或未知 schema 的账本；当前 ${CURRENT} 不兼容且不提供迁移。已在密码、KDF 和解密前停止；原文件未被写入、删除或覆盖。你仍可新建 ${CURRENT} 账本。`,
    );
  });

  it("names the current version when an import uses an unsupported valuation currency", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = [
      { ...ledgerData.assets[0], quoteCurrency: "EUR" as never },
    ];

    const result = validateLedgerImportPolicy(ledgerData, "2026-12-01");

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.message)).toContain(
      `${CURRENT} 只支持 USDT 估值`,
    );
  });
  it("names the current version in the English interface messages", () => {
    expect(translate("en", "policy.import.unsupportedValuationCurrency")).toBe(
      `${CURRENT} supports USDT valuation only`,
    );
    expect(translate("en", "backup.envelope.schemaVersionMiddleV5")).toContain(
      `the current ledger schema is ${CURRENT}`,
    );
    expect(translate("en", "access.fileError.retiredLedgerSchemaV4")).toContain(
      `the current ${CURRENT} is incompatible`,
    );
    expect(translate("en", "access.fileError.retiredLedgerSchemaV4")).toContain(
      `create a new ${CURRENT} ledger`,
    );
  });

  it("names the current version in the Chinese interface messages", () => {
    // Read through `translate` rather than `translateDefault("literal")` for
    // the same reason the rest of this file does: a literal call site here
    // would look like interface reuse to the translation-key usage guard.
    const zh = (key: Parameters<typeof translateDefault>[0]) =>
      translate(DEFAULT_LEDGER_LANGUAGE, key);

    expect(zh("backup.envelope.schemaVersionMiddleV5")).toContain(
      `当前账本 schema 为 ${CURRENT}`,
    );
    expect(zh("access.fileError.retiredLedgerSchemaV4")).toContain(
      `当前 ${CURRENT} 不兼容`,
    );
  });

  it("names the current version in the ledger structure validator", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        assetSymbol: "BTC",
        createdAt: "2026-01-01T00:00:00.000Z",
        currency: "EUR" as never,
        fee: "0",
        feeCurrency: "USDT",
        id: "trade-1",
        note: "",
        occurredAt: "2026-01-01",
        platform: "",
        price: "1",
        quantity: "1",
        rawText: "",
        timePrecision: "day",
        totalValue: "1",
        type: "buy",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as never,
    ];

    const result = validateLedgerData(ledgerData);

    expect(result.ok).toBe(false);
    expect(
      result.ok ? [] : result.errors.map((error) => error.message),
    ).toContain(`${CURRENT} trade currency must be USDT`);
  });

  it("names the current version in the price structure validator", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.priceSnapshots = [
      {
        assetSymbol: "BTC",
        binanceProvenance: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        currency: "EUR" as never,
        id: "price-1",
        note: "",
        recordedAt: "2026-01-01",
        recordedTimeZone: null,
        source: "manual",
        timePrecision: "day",
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: "1",
      } as never,
    ];

    const result = validateLedgerData(ledgerData);

    expect(result.ok).toBe(false);
    expect(
      result.ok ? [] : result.errors.map((error) => error.message),
    ).toContain(`${CURRENT} price currency must be USDT`);
  });

  it("names the current version in the two draft validators", () => {
    const assets = [
      {
        binanceMapping: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "asset-1",
        name: "Bitcoin",
        quoteCurrency: "EUR",
        symbol: "BTC",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as never,
    ];

    const tradeResult = validateTradeDraft(
      {
        assetSymbol: "BTC",
        currency: "EUR",
        fee: "0",
        feeCurrency: "USDT",
        occurredAt: "2026-01-01",
        price: "1",
        quantity: "1",
        timePrecision: "day",
        totalValue: "1",
        type: "buy",
      } as never,
      {
        assets,
        priorTrades: [],
        requireSupportedValuationCurrency: true,
        skipHoldingsTimeline: true,
      } as never,
    );
    expect(
      tradeResult.ok ? [] : tradeResult.errors.map((error) => error.message),
    ).toContain(`${CURRENT} supports USDT valuation only`);

    const priceResult = validatePriceSnapshotDraft(
      {
        assetSymbol: "BTC",
        currency: "EUR",
        recordedAt: "2026-01-01",
        source: "manual",
        timePrecision: "day",
        value: "1",
      } as never,
      assets,
      { requireSupportedValuationCurrency: true } as never,
    );
    expect(
      priceResult.ok ? [] : priceResult.errors.map((error) => error.message),
    ).toContain(`${CURRENT} supports USDT valuation only`);
  });
  it("prints ledger validator messages verbatim into the preflight report", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        assetSymbol: "BTC",
        createdAt: "2026-01-01T00:00:00.000Z",
        currency: "EUR",
        fee: "0",
        feeCurrency: "USDT",
        id: "trade-1",
        note: "",
        occurredAt: "2026-01-01",
        platform: "OKX",
        price: "10",
        quantity: "2",
        rawText: "fixture",
        timePrecision: "day",
        totalValue: "20",
        type: "buy",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as never,
    ];
    const serialized = JSON.stringify({
      backupFormatVersion: 3,
      appVersion: "0.1.0",
      exportedAt: "2026-01-02T00:00:00.000Z",
      ledgerSchemaVersion: SUPPORTED_LEDGER_SCHEMA_VERSION,
      ledgerData,
    });

    const result = await preflightBackupJson(serialized, {
      todayKey: "2026-02-01",
      selectionGeneration: 1,
      requireHistoricalRawText: false,
    });
    const report = formatBackupImportReportMarkdown(result);

    // The report copies a validator message verbatim, which is why any version
    // number written into one of those messages is interface wording rather
    // than an internal string. `deduplicateHardErrors` keeps one error per
    // (stage, code, path), so the sentence that survives here is whichever the
    // validator pushed first for this field.
    expect(report).toContain(
      "CURRENCY_MISMATCH: currency must match BTC quote currency and existing trades",
    );
    expect(report).not.toContain("V4 ");
  });
});
