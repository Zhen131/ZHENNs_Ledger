// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "./backupEnvelope";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  inspectLedgerBackupImportEvidence,
  preflightBackupJson,
  type BackupImportPreflightResult,
  type LedgerBackupImportEvidence,
} from "./backupImportPreflight";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "@/core/validation";
import type { LedgerData } from "@/core/models";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import { BackupControls } from "./BackupControls";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FIXED_EXPORTED_AT = "2026-07-23T12:34:56.000Z";
const FIXED_BACKUP_FILENAME =
  "local-first-trading-ledger-backup-v3-20260723-123456Z.json";
const fixedClock = {
  now: () => new Date(FIXED_EXPORTED_AT),
};

function byteLength(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

function padSerializedBackupToBytes(serialized: string, targetBytes: number): string {
  const currentBytes = byteLength(serialized);

  if (currentBytes > targetBytes) {
    throw new Error("Serialized fixture already exceeds target");
  }

  return `${serialized}${" ".repeat(targetBytes - currentBytes)}`;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createBackupFile(name = "ledger.json") {
  const envelope = createBackupEnvelope(createInitialLedgerData(), {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");
  const file = new File([serializeBackupEnvelope(envelope.value)], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serializeBackupEnvelope(envelope.value)),
  });
  return file;
}

function createBackupFileFromLedger(ledgerData: LedgerData, name: string) {
  const envelope = createBackupEnvelope(ledgerData, {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");
  const serialized = serializeBackupEnvelope(envelope.value);
  const file = new File([serialized], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return file;
}

function createPostImportPairingLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  const timestamp = "2026-07-20T08:00:00.000Z";
  ledgerData.assets.push(
    {
      id: "asset-sol-post-import",
      symbol: "SOL",
      name: "Solana",
      quoteCurrency: "USDT",
      binanceMapping: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "asset-knight-post-import",
      symbol: "KNIGHT",
      name: "Fictional Knight",
      quoteCurrency: "USDT",
      binanceMapping: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  );
  return ledgerData;
}

function createPermanentFixtureFile(name: string) {
  const serialized = readFileSync(
    `test-fixtures/w11-b-import/${name}`,
    "utf8",
  );
  const file = new File([serialized], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return { file, serialized };
}

function createPaddedBackupFile(serialized: string, name = "ledger.json") {
  const file = new File([serialized], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return file;
}

function createReadOnlyLedgerAtBackupBytes(targetBytes: number) {
  const ledgerData = {
    ...createInitialLedgerData(),
    trades: [
      {
        ...createSimpleTrade("boundary", "buy", "BTC", "1"),
        rawText: "",
      },
    ],
  };
  const envelope = createBackupEnvelope(ledgerData, {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");

  const serialized = serializeBackupEnvelope(envelope.value);
  ledgerData.trades[0].rawText = "x".repeat(targetBytes - byteLength(serialized));
  return ledgerData;
}

function stubBlobConstructor() {
  const OriginalBlob = Blob;
  const blobConstructor = vi.fn();
  class SpyBlob extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      blobConstructor(parts, options);
      super(parts, options);
    }
  }

  vi.stubGlobal("Blob", SpyBlob);
  return blobConstructor;
}

function stubBackupDownload() {
  const createObjectURL = vi.fn(() => "blob:backup");
  const revokeObjectURL = vi.fn();
  const blobConstructor = stubBlobConstructor();
  let filename = "";

  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function captureDownloadFilename(this: HTMLAnchorElement) {
      filename = this.download;
    },
  );

  return {
    blobConstructor,
    createObjectURL,
    getFilename: () => filename,
    revokeObjectURL,
  };
}

function getDownloadedEnvelope(blobConstructor: ReturnType<typeof vi.fn>) {
  const parts = blobConstructor.mock.calls[0]?.[0] as BlobPart[] | undefined;
  const serialized = parts?.[0];
  if (typeof serialized !== "string") {
    throw new Error("Expected serialized backup JSON in the download Blob");
  }
  const parsed = parseBackupJson(serialized);
  if (!parsed.ok) {
    throw new Error("Downloaded backup fixture must remain valid");
  }
  return parsed.value;
}

type FakeCFacts = {
  bytes: string;
  current: { revisionId: string; trades: number } | null;
  previous: { revisionId: string; trades: number } | null;
  revision: string;
  pageLedger: ReturnType<typeof createInitialLedgerData>;
  repositoryWrites: number;
  importPortCalls: number;
};

function createFakeCWriteSentinel() {
  const facts: FakeCFacts = {
    bytes: "encrypted-old-current",
    current: { revisionId: "revision-0", trades: 0 },
    previous: null,
    revision: "revision-0",
    pageLedger: createInitialLedgerData(),
    repositoryWrites: 0,
    importPortCalls: 0,
  };
  const before = structuredClone(facts);
  const onImport = vi.fn(async () => {
    facts.importPortCalls += 1;
    facts.repositoryWrites += 1;
    facts.bytes = "unexpected-new-bytes";
    facts.previous = facts.current;
    facts.current = { revisionId: "unexpected-revision", trades: 1 };
    facts.revision = "unexpected-revision";
    facts.pageLedger.trades = [
      createSimpleTrade("unexpected-page-trade", "buy", "BTC", "1"),
    ];
    return { ok: true };
  });

  return { before, facts, onImport };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function renderControls(
  overrides: Partial<ComponentProps<typeof BackupControls>> = {},
) {
  const onImport = vi.fn(async () => ({ ok: true }));
  const view = render(
    <BackupControls
      hydrationStatus="ready"
      isDirty={false}
      isReadOnly={false}
      ledgerData={createInitialLedgerData()}
      onImport={onImport}
      persistenceOperation="idle"
      persistenceStatus="idle"
      {...overrides}
    />,
  );
  return { onImport, ...view };
}

describe("BackupControls", () => {
  it.each(["loading", "ready", "error"] as const)(
    "keeps the plaintext backup risk visible while hydration is %s",
    (hydrationStatus) => {
      renderControls({ hydrationStatus });

      expect(
        screen.getByText(
          /账本备份是未加密明文，任何能访问文件的人都可能读取完整资产、交易和价格/,
        ),
      ).not.toBeNull();
      expect(screen.getByText(/导出只会发起浏览器下载/)).not.toBeNull();
      expect(screen.getByText(/同步目录，系统可能自动上传或同步/)).not.toBeNull();
    },
  );

  it("exports the current in-memory ledger rather than reading the repository", async () => {
    const download = stubBackupDownload();
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("current-page", "buy", "BTC", "1")],
    };
    renderControls({ clock: fixedClock, ledgerData });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.revokeObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData.trades[0]?.id,
    ).toBe("current-page");
    const message = screen.getByText(/已发起备份下载/).textContent;
    expect(message).toContain("备份为明文、未加密");
    expect(message).toContain("检查浏览器下载是否成功及实际保存位置");
    expect(message).toContain("移至安全位置或在不再需要时删除");
  });

  it("exports all four collections and 300 historical rawText values without derived or session state", async () => {
    const source = parseBackupJson(
      readFileSync(
        "test-fixtures/w11-b-import/valid-300.backup.json",
        "utf8",
      ),
    );
    if (!source.ok) throw new Error("Permanent export fixture must be valid");
    const download = stubBackupDownload();
    renderControls({
      clock: fixedClock,
      ledgerData: source.value.ledgerData,
    });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "导出完整账本备份" }),
    );

    const downloaded = getDownloadedEnvelope(download.blobConstructor);
    expect(downloaded.ledgerData).toEqual(source.value.ledgerData);
    expect(downloaded.ledgerData.trades).toHaveLength(300);
    expect(
      downloaded.ledgerData.trades.every(
        (trade, index) =>
          trade.rawText ===
          `虚构历史交易原句 ${index + 1}：买入测试资产，非真实用户数据。`,
      ),
    ).toBe(true);
    expect(Object.keys(downloaded)).toEqual([
      "backupFormatVersion",
      "appVersion",
      "exportedAt",
      "ledgerSchemaVersion",
      "ledgerData",
    ]);
    expect(Object.keys(downloaded.ledgerData)).toEqual([
      "schemaVersion",
      "assets",
      "trades",
      "cashEvents",
      "priceSnapshots",
      "feeRules",
    ]);
  });

  it("downloads the dirty in-memory ledger as a clearly labeled rescue backup", async () => {
    const download = stubBackupDownload();
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("dirty-page", "buy", "BTC", "1")],
    };
    renderControls({
      clock: fixedClock,
      isDirty: true,
      ledgerData,
      persistenceStatus: "error",
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData.trades[0]?.id,
    ).toBe("dirty-page");
    const message = screen.getByText(/已发起救援备份下载/).textContent;
    expect(message).toContain("备份为明文、未加密");
    expect(message).toContain("可能新于最后成功保存的版本");
    expect(message).toContain("实际保存位置");
  });

  it("rejects a resource-invalid read-only rescue before Blob creation", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(blobConstructor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "无法导出：当前账本未通过 V3 结构、资源或业务校验。",
      ),
    ).not.toBeNull();
  });

  it("does not construct a Blob when the serialized envelope exceeds 8 MiB by one byte", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(blobConstructor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "无法导出：当前账本未通过 V3 结构、资源或业务校验。",
      ),
    ).not.toBeNull();
  });

  it("rejects a real legal backup that exceeds 8 MiB by one byte before File.text", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const exactLimit = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const serialized = `${exactLimit} `;
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1);
    expect(parseBackupJson(serialized)).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "LEDGER_RESOURCE_FILE_TOO_LARGE" }),
      ],
    });
    expect(file.text).not.toHaveBeenCalled();
    expect(screen.getByText("无法导入：文件超过 8 MiB 限制。")).not.toBeNull();
  });

  it("accepts a real legal backup whose content is exactly 8 MiB", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const serialized = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(byteLength(serialized)).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(parseBackupJson(serialized)).toEqual({
      ok: true,
      value: expect.any(Object),
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(file.text).toHaveBeenCalledOnce();
  });

  it("requires confirmation before replacing the ledger", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), createBackupFile());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(onImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认恢复备份" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });
  });

  it("keeps import at zero network, then saves mapping before a separate first-price mutation after explicit pairing", async () => {
    let currentLedger = createInitialLedgerData();
    let ledgerEpoch = 0;
    let mutationVersion = 0;
    let persistedVersion = 0;
    let persistenceStatus: ComponentProps<
      typeof BackupControls
    >["persistenceStatus"] = "saved";
    const importedLedger = createPostImportPairingLedger();
    const onImport = vi.fn<
      ComponentProps<typeof BackupControls>["onImport"]
    >(async (candidate) => {
      currentLedger = structuredClone(candidate);
      return { ok: true };
    });
    const client: BinanceMarketDataClient = {
      validateSpotSymbol: vi.fn(async (assetSymbol, marketSymbol) =>
        assetSymbol === "SOL"
          ? {
              ok: true as const,
              value: {
                symbol: marketSymbol,
                status: "TRADING",
                baseAsset: "SOL",
                quoteAsset: "USDT",
                isSpotTradingAllowed: true,
              },
            }
          : {
              ok: false as const,
              error: {
                code: "BINANCE_VALIDATION_UNAVAILABLE" as const,
                symbol: marketSymbol,
                message: "Symbol validation failed before a readable response arrived",
              },
            },
      ),
      fetchLatestPrices: vi.fn(async () => ({
        prices: [{ symbol: "SOLUSDT", price: "150" }],
        failures: [],
      })),
    };
    const applyLedgerMutation = vi.fn<
      NonNullable<
        ComponentProps<typeof BackupControls>["applyLedgerMutation"]
      >
    >((mutation) => {
      const next = mutation(currentLedger);
      if (next === currentLedger) return "noop";
      currentLedger = next;
      mutationVersion += 1;
      persistenceStatus = "saving";
      return "applied";
    });
    const generateId = vi.fn(() => "price-sol-post-import");
    const element = () => (
      <BackupControls
        applyLedgerMutation={applyLedgerMutation}
        clock={fixedClock}
        generateId={generateId}
        hydrationStatus="ready"
        isDirty={false}
        isReadOnly={false}
        isWritable
        ledgerData={currentLedger}
        ledgerEpoch={ledgerEpoch}
        marketDataClient={client}
        mutationVersion={mutationVersion}
        onImport={onImport}
        persistedVersion={persistedVersion}
        persistenceOperation="idle"
        persistenceStatus={persistenceStatus}
        sessionGeneration={ledgerEpoch}
      />
    );
    const view = render(element());
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createBackupFileFromLedger(
        importedLedger,
        "fictional-post-import-pairing.json",
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );
    await screen.findByText("备份已恢复并保存到本地。");
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(applyLedgerMutation).not.toHaveBeenCalled();

    ledgerEpoch = 1;
    view.rerender(element());
    await user.click(
      screen.getByRole("button", {
        name: "联网自动配对缺失资产",
      }),
    );
    await waitFor(() => {
      expect(client.validateSpotSymbol).toHaveBeenCalledTimes(2);
      expect(applyLedgerMutation).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/mapping，保存成功前不会请求价格/)).not.toBeNull();
    });
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(client.validateSpotSymbol).toHaveBeenNthCalledWith(
      1,
      "KNIGHT",
      "KNIGHTUSDT",
      expect.any(AbortSignal),
    );
    expect(client.validateSpotSymbol).toHaveBeenNthCalledWith(
      2,
      "SOL",
      "SOLUSDT",
      expect.any(AbortSignal),
    );
    expect(
      currentLedger.assets.find(({ symbol }) => symbol === "SOL")
        ?.binanceMapping?.symbol,
    ).toBe("SOLUSDT");
    expect(
      currentLedger.assets.find(({ symbol }) => symbol === "KNIGHT")
        ?.binanceMapping,
    ).toBeNull();

    persistedVersion = mutationVersion;
    persistenceStatus = "saved";
    view.rerender(element());
    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledWith(
        ["SOLUSDT"],
        expect.any(AbortSignal),
      );
      expect(applyLedgerMutation).toHaveBeenCalledTimes(2);
    });
    expect(currentLedger.priceSnapshots).toEqual([
      expect.objectContaining({
        id: "price-sol-post-import",
        assetSymbol: "SOL",
        price: "150",
        source: "api",
      }),
    ]);

    persistedVersion = mutationVersion;
    persistenceStatus = "saved";
    view.rerender(element());
    await waitFor(() => {
      expect(
        screen.getByText(
          /mapping 已保存 1 项，价格已保存 1 项，失败 1 项/,
        ),
      ).not.toBeNull();
    });
    expect(screen.getByText("BINANCE_VALIDATION_UNAVAILABLE")).not.toBeNull();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "LI" &&
            element.textContent?.includes(
              "当前无法验证该 Binance 交易对。该交易对可能不存在，也可能是 Binance 的错误响应无法被浏览器读取，或当前网络／服务暂时不可用。本地资产、历史交易和手动价格均未改变，可以继续使用手动价格或稍后重试。",
            ),
        ),
      ),
    ).not.toBeNull();
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("binds the exact preflight identities and a live cancellation signal to the import call", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const expected = await preflightBackupJson(serialized, {
      todayKey: "2026-07-23",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const onImport = vi.fn<
      ComponentProps<typeof BackupControls>["onImport"]
    >(async () => ({ ok: true }));
    renderControls({
      canImportBackup: true,
      requiresHistoricalRawText: true,
      onImport,
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      file,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "确认恢复备份",
      }),
    );
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
    });

    const [candidate, , evidence, signal] =
      onImport.mock.calls[0] ?? [];
    expect(candidate).toEqual(expected.candidate);
    expect(evidence).toEqual({
      contentIdentity: expected.contentIdentity.value,
      candidateIdentity: expected.candidateIdentity,
      selectionGeneration: expected.selectionGeneration,
      hardErrorCount: 0,
      suspiciousGroupCount: 0,
      suspiciousGroupIdentity: expected.suspiciousGroupIdentity,
      confirmedSuspiciousGroupIdentity: null,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("keeps the invalid 147th trade outside the import callback even when C import capability is enabled", async () => {
    const { file } = createPermanentFixtureFile(
      "invalid-trade-147.backup.json",
    );
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: true,
      requiresHistoricalRawText: true,
      onImport,
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      file,
    );

    await screen.findAllByText(/trades\[146\]\.quantity/);
    expect(
      screen.queryByRole("button", { name: "确认恢复备份" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("rejects V2 B before import, file mutation, or Binance calls", async () => {
    const parsed = JSON.parse(
      readFileSync(
        "test-fixtures/w11-b-import/valid-300.backup.json",
        "utf8",
      ),
    );
    parsed.backupFormatVersion = 2;
    const client: BinanceMarketDataClient = {
      validateSpotSymbol: vi.fn(),
      fetchLatestPrices: vi.fn(),
    };
    const onImport = vi.fn(async () => ({ ok: true }));
    const applyLedgerMutation = vi.fn(() => "applied" as const);
    renderControls({
      applyLedgerMutation,
      canImportBackup: true,
      isWritable: true,
      marketDataClient: client,
      onImport,
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      createPaddedBackupFile(
        `${JSON.stringify(parsed, null, 2)}\n`,
        "fictional-v2.backup.json",
      ),
    );

    await screen.findAllByText(/这是 V2 备份；V3 不提供迁移/);
    expect(
      screen.queryByRole("button", { name: "确认恢复备份" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(applyLedgerMutation).not.toHaveBeenCalled();
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
  });

  it.each(["cancel", "unmount"] as const)(
    "aborts the bound import signal on %s while a C import is pending",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "valid-300.backup.json",
      );
      const pending = createDeferred<{
        ok: false;
        code: "LEDGER_IMPORT_CANCELLED";
      }>();
      let capturedSignal: AbortSignal | undefined;
      let capturedEvidence:
        | LedgerBackupImportEvidence
        | undefined;
      const onImport = vi.fn<
        ComponentProps<typeof BackupControls>["onImport"]
      >(
        async (
          _candidate,
          _timeSnapshot,
          evidence,
          signal,
        ) => {
          capturedEvidence = evidence;
          capturedSignal = signal;
          return pending.promise;
        },
      );
      const view = renderControls({
        canImportBackup: true,
        requiresHistoricalRawText: true,
        onImport,
      });
      const user = userEvent.setup();

      await user.upload(
        screen.getByLabelText("选择账本备份文件"),
        fixture.file,
      );
      await user.click(
        await screen.findByRole("button", {
          name: "确认恢复备份",
        }),
      );
      await waitFor(() => {
        expect(onImport).toHaveBeenCalledOnce();
        expect(
          screen.getByText(
            /取消时会尝试恢复并复读导入前的完整内容；如果无法确认恢复，当前会话会停止后续写入并明确报错/,
          ),
        ).not.toBeNull();
        expect(capturedSignal?.aborted).toBe(false);
        expect(capturedEvidence).toBeDefined();
        if (capturedEvidence) {
          expect(
            inspectLedgerBackupImportEvidence(
              capturedEvidence,
            ),
          ).not.toBeNull();
        }
      });

      if (action === "cancel") {
        await user.click(
          screen.getByRole("button", { name: "取消" }),
        );
      } else {
        view.unmount();
      }
      expect(capturedSignal?.aborted).toBe(true);
      if (capturedEvidence) {
        expect(
          inspectLedgerBackupImportEvidence(capturedEvidence),
        ).toBeNull();
      }

      await act(async () => {
        pending.resolve({
          ok: false,
          code: "LEDGER_IMPORT_CANCELLED",
        });
        await pending.promise;
      });
      expect(onImport).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "LEDGER_IMPORT_CANCELLED",
      "已取消导入；当前页面未替换。",
    ],
    [
      "LEDGER_IMPORT_BASE_RESTORED",
      "导入未完成；已复读确认原账本文件恢复为导入前的完整版本，当前页面未变更。",
    ],
    [
      "LEDGER_IMPORT_SOURCE_CHANGED",
      "导入写入前发现账本文件已发生外部变化；本次导入没有写入，请重新打开该文件。",
    ],
    [
      "LEDGER_IMPORT_RECOVERY_BLOCKED",
      "无法确认导入结果，也无法证明原账本文件已恢复；当前会话已停止写入，请立即锁定并保留文件用于恢复。",
    ],
    [
      "LEDGER_REPOSITORY_WRITE_FAILED",
      "导入失败；当前页面未变更。没有取得可进一步确认底层存储状态的证据，请按错误提示处理。",
    ],
  ] as const)(
    "reports %s without overstating recovery evidence",
    async (code, expectedMessage) => {
      const onImport = vi.fn<
        ComponentProps<typeof BackupControls>["onImport"]
      >(async () => ({ ok: false, code }));
      renderControls({ onImport });
      const user = userEvent.setup();
      const file = createBackupFile();
      const beforeHash = sha256(await file.text());

      await user.upload(
        screen.getByLabelText("选择账本备份文件"),
        file,
      );
      await user.click(
        await screen.findByRole("button", {
          name: "确认恢复备份",
        }),
      );

      expect(await screen.findByText(expectedMessage)).not.toBeNull();
      expect(sha256(await file.text())).toBe(beforeHash);
    },
  );

  it("shows the complete backup candidate and lets the same file be selected after cancel", async () => {
    renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");
    const file = createBackupFile();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(screen.getByText("应用版本")).not.toBeNull();
    expect(screen.getByText("导出时间")).not.toBeNull();
    expect(screen.getByText("资产")).not.toBeNull();
    expect(screen.getByText("交易")).not.toBeNull();
    expect(screen.getByText("价格快照")).not.toBeNull();
    expect(screen.getByText("手续费规则")).not.toBeNull();
    expect(screen.getByText(/原备份文件仍是未加密明文/)).not.toBeNull();
    expect(screen.getByText(/本应用不会移动、删除或主动上传该文件/)).not.toBeNull();
    expect(screen.getByText(/同步目录，系统可能自动同步/)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
  });

  it("lets the same file be selected after a successful import", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");
    const file = createBackupFile();
    const beforeHash = sha256(await file.text());

    await user.upload(input, file);
    await user.click(
      await screen.findByRole("button", { name: "确认恢复备份" }),
    );
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("备份已恢复并保存到本地。")).not.toBeNull();
    });
    expect(sha256(await file.text())).toBe(beforeHash);

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(sha256(await file.text())).toBe(beforeHash);
  });

  it("shows structured parser errors and clears them on a new selection", async () => {
    renderControls();
    const invalidFile = new File(["{"], "invalid.json", {
      type: "application/json",
    });
    Object.defineProperty(invalidFile, "text", {
      configurable: true,
      value: vi.fn(async () => "{"),
    });
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, invalidFile);
    await waitFor(() => {
      expect(screen.getByText(/BACKUP_BAD_JSON/)).not.toBeNull();
      expect(screen.getByText(/发现 1 项导入错误/)).not.toBeNull();
    });

    await user.upload(input, createBackupFile("valid.json"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认恢复备份" })).not.toBeNull();
    });
    expect(screen.queryByText(/BACKUP_BAD_JSON/)).toBeNull();
  });

  it("ignores an earlier file read after the user selects a newer file", async () => {
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const firstRead = createDeferred<string>();
    const firstFile = createBackupFile("first.json");
    Object.defineProperty(firstFile, "text", {
      configurable: true,
      value: vi.fn(() => firstRead.promise),
    });
    const secondFile = createBackupFile("second.json");
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, firstFile);
    await user.upload(input, secondFile);
    await waitFor(() => {
      expect(screen.getByText("明文备份预检报告")).not.toBeNull();
    });
    await act(async () => {
      firstRead.resolve("{");
      await firstRead.promise;
    });

    expect(screen.queryByText("无法导入：备份文件格式或内容无效。")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "确认恢复备份" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after the user cancels",
    async (settlement) => {
      const { before, facts, onImport } = createFakeCWriteSentinel();
      renderControls({ canImportBackup: false, onImport });
      const read = createDeferred<string>();
      const file = createBackupFile("pending.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("选择账本备份文件"), file);
      expect(screen.getByText("正在读取备份文件。")).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "取消" }));

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
      expect(screen.queryByText("无法读取备份文件。")).toBeNull();
      expect(
        screen.queryByText("无法导入：备份文件格式或内容无效。"),
      ).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after unmount",
    async (settlement) => {
      const read = createDeferred<string>();
      const file = createBackupFile("pending-unmount.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("选择账本备份文件"), file);
      view.unmount();

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("opens strict read-only preflight for C while keeping import, repository and every fake C fact at zero writes", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    await waitFor(() => {
      expect(screen.getByText("明文备份预检报告")).not.toBeNull();
      expect(screen.getByText(/当前账本仅开放明文备份的只读预检/)).not.toBeNull();
    });
    expect(screen.getByText("300")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
    expect(screen.queryByRole("button", { name: "我已核对全部可疑组" })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
    expect(file.text).toHaveBeenCalledOnce();
    expect(serialized).toBe(
      readFileSync(
        "test-fixtures/w11-b-import/valid-300.backup.json",
        "utf8",
      ),
    );
  });

  it.each([
    "read-failure",
    "oversized",
    "bad-json",
    "hard-error",
    "business-error",
  ] as const)(
    "keeps import, repository, bytes, generations, revision and page data unchanged for C %s",
    async (scenario) => {
      const { before, facts, onImport } = createFakeCWriteSentinel();
      renderControls({ canImportBackup: false, onImport });
      const user = userEvent.setup();
      let file: File;

      if (scenario === "read-failure") {
        file = createBackupFile("read-failure.json");
        Object.defineProperty(file, "text", {
          configurable: true,
          value: vi.fn(async () => {
            throw new Error("read failed");
          }),
        });
      } else if (scenario === "oversized") {
        file = createPaddedBackupFile(
          "x".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1),
          "oversized.json",
        );
      } else if (scenario === "bad-json") {
        file = createPaddedBackupFile("{", "bad-json.json");
      } else if (scenario === "hard-error") {
        file = createPermanentFixtureFile(
          "invalid-trade-147.backup.json",
        ).file;
      } else {
        const parsed = JSON.parse(
          createPermanentFixtureFile(
            "valid-300.backup.json",
          ).serialized,
        );
        parsed.ledgerData.trades[0].occurredAt =
          "2099-01-01T00:00:00Z";
        file = createPaddedBackupFile(
          `${JSON.stringify(parsed, null, 2)}\n`,
          "future-business-error.json",
        );
      }

      await user.upload(
        screen.getByLabelText("选择账本备份文件"),
        file,
      );

      if (scenario === "read-failure") {
        await screen.findByText("无法读取备份文件。");
      } else if (scenario === "oversized") {
        expect(
          screen.getByText("无法导入：文件超过 8 MiB 限制。"),
        ).not.toBeNull();
      } else if (scenario === "bad-json") {
        await screen.findByText(/BACKUP_BAD_JSON/);
      } else if (scenario === "hard-error") {
        await screen.findAllByText(/trades\[146\]\.quantity/);
      } else {
        await screen.findByText(/LEDGER_IMPORT_FUTURE_FACT/);
      }

      expect(
        screen.queryByRole("button", { name: "确认恢复备份" }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "取消" }));
      expect(
        screen.queryByText("明文备份预检报告"),
      ).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("shows hard errors and duplicate warnings together for C but cannot forge a write through suspicion confirmation", async () => {
    const { file } = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    const onImport = vi.fn(async () => ({ ok: true }));
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);

    await waitFor(() => {
      expect(screen.getAllByText(/trades\[0\]\.quantity/).length).toBeGreaterThan(0);
      expect(screen.getByText(/高度可疑/)).not.toBeNull();
      expect(screen.getByText(/一般可疑/)).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "我已核对全部可疑组" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("keeps the selected B byte-for-byte unchanged through preflight, report copy, suspicion confirmation and cancel", async () => {
    const { file, serialized } = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const beforeHash = sha256(await file.text());
    const { before, facts, onImport } = createFakeCWriteSentinel();
    const writeText = vi.fn(async (markdown: string) => {
      void markdown;
    });
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      file,
    );
    await screen.findByRole("button", {
      name: "我已核对全部可疑组",
    });
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(
      screen.getByRole("button", { name: "复制 Markdown 报告" }),
    );
    await screen.findByText("报告已复制。");
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(
      screen.getByRole("button", { name: "我已核对全部可疑组" }),
    );
    expect(screen.getByText(/已确认当前可疑组/)).not.toBeNull();
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(sha256(await file.text())).toBe(beforeHash);
    expect(sha256(serialized)).toBe(beforeHash);
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("binds one suspicion acknowledgement to the current C preflight without opening a write button", async () => {
    const { file } = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const onImport = vi.fn(async () => ({ ok: true }));
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "我已核对全部可疑组" }),
      ).not.toBeNull();
    });
    await user.click(
      screen.getByRole("button", { name: "我已核对全部可疑组" }),
    );

    expect(screen.getByText(/已确认当前可疑组/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("renders only 50 details but copies the permanent 1000-item Markdown report with an honest 1001 truncation", async () => {
    const { file } = createPermanentFixtureFile(
      "report-1001.backup.json",
    );
    const writeText = vi.fn(async (markdown: string) => {
      void markdown;
    });
    renderControls({ canImportBackup: false });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);
    const detailList = await screen.findByRole("list", {
      name: "预检详情（页面最多 50 项）",
    });
    expect(within(detailList).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByText(/1000 \/ 1001 项/)).not.toBeNull();
    expect(screen.getByText(/第 1001 项后已截断/)).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "复制 Markdown 报告" }),
    );
    await waitFor(() => {
      expect(screen.getByText("报告已复制。")).not.toBeNull();
    });
    const markdown = writeText.mock.calls[0]?.[0];
    expect(markdown).toContain("隐私提醒");
    expect(markdown).toContain("`trades[999].quantity`");
    expect(markdown).not.toContain("`trades[1000].quantity`");
    expect(markdown).toContain("详情总数：1001");
  });

  it("does not claim a report was copied when the clipboard rejects", async () => {
    const { file } = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    renderControls({ canImportBackup: false });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("clipboard denied");
        }),
      },
    });

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);
    await screen.findByText("明文备份预检报告");
    await user.click(
      screen.getByRole("button", { name: "复制 Markdown 报告" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/复制失败/)).not.toBeNull();
    });
    expect(screen.queryByText("报告已复制。")).toBeNull();
  });

  it("invalidates a late preflight after cancel before it can revive a report or write action", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const eventualResult = await preflightBackupJson(serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const eventualEvidence =
      createLedgerBackupImportEvidence(eventualResult);
    expect(eventualEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const preflight = vi.fn(() => pending.promise);
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: false,
      onImport,
      preflight,
    });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("选择账本备份文件"), file);
    await waitFor(() => {
      expect(preflight).toHaveBeenCalledOnce();
      expect(screen.getByText(/正在执行只读预检/)).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => {
      pending.resolve(eventualResult);
      await pending.promise;
    });

    expect(screen.queryByText("明文备份预检报告")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认恢复备份" })).toBeNull();
    expect(createLedgerBackupImportEvidence(eventualResult)).toBeNull();
    expect(inspectLedgerBackupImportEvidence(eventualEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates an older preflight after a newer file selection", async () => {
    const first = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const second = createPermanentFixtureFile("valid-300.backup.json");
    const firstResult = await preflightBackupJson(first.serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const firstConfirmation =
      confirmBackupImportSuspiciousGroups(firstResult);
    const firstEvidence = createLedgerBackupImportEvidence(
      firstResult,
      firstConfirmation,
    );
    expect(firstEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const preflight = vi.fn(
      (
        text: string,
        options: Parameters<typeof preflightBackupJson>[1],
      ) =>
        text === first.serialized
          ? pending.promise
          : preflightBackupJson(text, options),
    );
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: false,
      onImport,
      preflight,
    });
    const user = userEvent.setup();
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, first.file);
    await screen.findByText(/正在执行只读预检/);
    await user.upload(input, second.file);
    await waitFor(() => {
      expect(screen.getByText("300")).not.toBeNull();
    });
    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
    });

    expect(screen.getByText("300")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "我已核对全部可疑组" }),
    ).toBeNull();
    expect(
      createLedgerBackupImportEvidence(
        firstResult,
        firstConfirmation,
      ),
    ).toBeNull();
    expect(inspectLedgerBackupImportEvidence(firstEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates a late preflight after unmount", async () => {
    const fixture = createPermanentFixtureFile("valid-300.backup.json");
    const eventualResult = await preflightBackupJson(fixture.serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const eventualEvidence =
      createLedgerBackupImportEvidence(eventualResult);
    expect(eventualEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const { before, facts, onImport } = createFakeCWriteSentinel();
    const view = renderControls({
      canImportBackup: false,
      onImport,
      preflight: vi.fn(() => pending.promise),
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("选择账本备份文件"),
      fixture.file,
    );
    await screen.findByText(/正在执行只读预检/);
    view.unmount();
    await act(async () => {
      pending.resolve(eventualResult);
      await pending.promise;
    });

    expect(createLedgerBackupImportEvidence(eventualResult)).toBeNull();
    expect(inspectLedgerBackupImportEvidence(eventualEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates a late clipboard success when a newer file is selected", async () => {
    const first = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    const second = createPermanentFixtureFile("valid-300.backup.json");
    const clipboard = createDeferred<void>();
    const writeText = vi.fn((markdown: string) => {
      void markdown;
      return clipboard.promise;
    });
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const input = screen.getByLabelText("选择账本备份文件");

    await user.upload(input, first.file);
    await screen.findByText("明文备份预检报告");
    await user.click(
      screen.getByRole("button", { name: "复制 Markdown 报告" }),
    );
    expect(screen.getByText("正在复制报告。")).not.toBeNull();

    await user.upload(input, second.file);
    await waitFor(() => {
      expect(screen.getByText("300")).not.toBeNull();
    });
    await act(async () => {
      clipboard.resolve();
      await clipboard.promise;
    });

    expect(screen.queryByText("报告已复制。")).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it.each(["cancel", "unmount"] as const)(
    "invalidates a late clipboard success after %s",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "preflight-errors-and-duplicates.backup.json",
      );
      const clipboard = createDeferred<void>();
      const writeText = vi.fn((markdown: string) => {
        void markdown;
        return clipboard.promise;
      });
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      await user.upload(
        screen.getByLabelText("选择账本备份文件"),
        fixture.file,
      );
      await screen.findByText("明文备份预检报告");
      await user.click(
        screen.getByRole("button", { name: "复制 Markdown 报告" }),
      );
      expect(screen.getByText("正在复制报告。")).not.toBeNull();
      if (action === "cancel") {
        await user.click(screen.getByRole("button", { name: "取消" }));
      } else {
        view.unmount();
      }
      await act(async () => {
        clipboard.resolve();
        await clipboard.promise;
      });

      if (action === "cancel") {
        expect(screen.queryByText("报告已复制。")).toBeNull();
      }
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it.each(["reselect", "cancel", "unmount"] as const)(
    "invalidates a suspicion confirmation token after %s",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "suspicions-only.backup.json",
      );
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();
      let input = screen.getByLabelText("选择账本备份文件");

      await user.upload(input, fixture.file);
      await screen.findByRole("button", {
        name: "我已核对全部可疑组",
      });
      await user.click(
        screen.getByRole("button", { name: "我已核对全部可疑组" }),
      );
      expect(screen.getByText(/已确认当前可疑组/)).not.toBeNull();

      if (action === "cancel") {
        await user.click(screen.getByRole("button", { name: "取消" }));
        input = screen.getByLabelText("选择账本备份文件");
      } else if (action === "unmount") {
        view.unmount();
        renderControls({ canImportBackup: false, onImport });
        input = screen.getByLabelText("选择账本备份文件");
      }
      await user.upload(input, fixture.file);

      expect(
        await screen.findByRole("button", {
          name: "我已核对全部可疑组",
        }),
      ).not.toBeNull();
      expect(screen.queryByText(/已确认当前可疑组/)).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("reports a download driver exception without claiming the backup was started or safe", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        throw new Error("object URL failed");
      }),
      revokeObjectURL: vi.fn(),
    });
    renderControls({ clock: fixedClock });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "导出完整账本备份" }),
    );

    expect(screen.getByText(/无法确认下载是否成功/)).not.toBeNull();
    expect(screen.queryByText(/已发起备份下载/)).toBeNull();
    expect(screen.queryByText(/已安全保存/)).toBeNull();
  });

  it("states that a read-only rescue backup may not be importable", async () => {
    const download = stubBackupDownload();
    renderControls({ clock: fixedClock, isReadOnly: true });
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "导出完整账本备份" })).not.toBeNull();
    expect(screen.queryByLabelText("选择账本备份文件")).toBeNull();
    expect(
      screen.getByText(
        /备份可能因集合或字符串超限而无法由当前版本重新导入/,
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "导出完整账本备份" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData,
    ).toEqual(createInitialLedgerData());
    const message = screen.getByText(
      /已发起只读救援备份下载/,
    ).textContent;
    expect(message).toContain(
      "可能因集合或字符串超限而无法由当前版本重新导入",
    );
    expect(message).toContain("备份为明文、未加密");
    expect(message).toContain("实际保存位置");
  });

  it("shows recovery import but no export after hydration fails", () => {
    renderControls({ hydrationStatus: "error" });

    expect(screen.queryByRole("button", { name: "导出完整账本备份" })).toBeNull();
    expect(screen.getByLabelText("选择账本备份文件")).not.toBeNull();
    expect(screen.getByText("可使用有效备份恢复本地账本。")).not.toBeNull();
  });
});
