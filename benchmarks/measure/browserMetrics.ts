import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright";

import {
  generateSyntheticLedger,
  SYNTHETIC_SCALE_TRADE_COUNTS,
  withSyntheticBackupFile,
  type SyntheticLedgerResult,
  type SyntheticScale,
} from "../generator/syntheticLedger";
import {
  installFilePickerStub,
  readPickerCalls,
  type BenchmarkPickerCalls,
} from "./filePickerStub";
import {
  roundDuration,
  summarizeDurations,
  type DurationStatistics,
} from "./report";

export type BrowserBenchmarkMode = "dev" | "production";

export type BrowserMetricResult = Readonly<{
  metric: "M-1" | "M-3" | "M-4" | "M-5" | "M-6";
  operation: string;
  statistics: DurationStatistics;
  samplesMs: readonly number[];
  discardedWarmupMs: number;
}>;

export type BrowserBenchmarkSuccess = Readonly<{
  kind: "browser-benchmark";
  status: "completed";
  mode: BrowserBenchmarkMode;
  scale: SyntheticScale;
  tradeCount: number;
  samplesPerMetric: number;
  browserVersion: string;
  setupMs: number;
  wrongPasswordRejected: true;
  pickerCalls: BenchmarkPickerCalls;
  metrics: readonly BrowserMetricResult[];
  consoleErrors: readonly string[];
  temporaryArtifactsCleaned: true;
}>;

export type BrowserBenchmarkFailure = Readonly<{
  kind: "browser-benchmark";
  status: "setup-failed";
  mode: BrowserBenchmarkMode;
  scale: SyntheticScale;
  tradeCount: number;
  stage: string;
  reason: string;
  consoleErrors: readonly string[];
  temporaryArtifactsCleaned: true;
}>;

export type BrowserBenchmarkResult =
  | BrowserBenchmarkSuccess
  | BrowserBenchmarkFailure;

export type RunBrowserBenchmarkOptions = Readonly<{
  mode: BrowserBenchmarkMode;
  scale: SyntheticScale;
  sampleCount?: number;
  headless?: boolean;
  channel?: "chrome" | "chromium";
}>;

const PASSPHRASE = "Benchmark-only-passphrase-2026";
const CONNECTION_DATABASE = "local-first-trading-ledger-file-connections";
const CONNECTION_STORE = "connections";
const CONNECTION_KEY = "current:v1";

export async function runBrowserBenchmark(
  options: RunBrowserBenchmarkOptions,
): Promise<BrowserBenchmarkResult> {
  const sampleCount = options.sampleCount ?? defaultSampleCount(options.scale);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error("Browser benchmark sample count must be a positive integer");
  }

  const profileDirectory = await mkdtemp(join(tmpdir(), "lftl-browser-benchmark-"));
  const consoleErrors: string[] = [];
  let server: ChildProcess | undefined;
  let context: BrowserContext | undefined;
  let pendingResult:
    | Omit<BrowserBenchmarkSuccess, "temporaryArtifactsCleaned">
    | Omit<BrowserBenchmarkFailure, "temporaryArtifactsCleaned">;

  try {
    const generated = generateSyntheticLedger({ scale: options.scale });
    const port = await reservePort();
    server = startNextServer(options.mode, port);
    await waitForServer(`http://127.0.0.1:${port}`);

    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: options.channel === "chromium" ? undefined : "chrome",
      headless: options.headless ?? true,
      viewport: { width: 1280, height: 800 },
    });
    await installFilePickerStub(context);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const browserVersion = context.browser()?.version() ?? "unknown";
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const setupStart = performance.now();
      await createAndImport(page, baseUrl, generated);
      const setupMs = roundDuration(performance.now() - setupStart);
      const wrongPasswordRejected = await proveWrongPasswordRejection(
        page,
        baseUrl,
      );
      if (!wrongPasswordRejected) {
        throw new BenchmarkSetupError(
          "wrong-password",
          "The product did not visibly reject an incorrect password",
        );
      }

      const metrics: BrowserMetricResult[] = [];
      metrics.push(
        await sampleAsyncMetric("M-1", "open-unlock-home", sampleCount, () =>
          measureColdOpen(page, baseUrl),
        ),
      );
      await ensureUnlocked(page);
      await tagBenchmarkSelectors(page);

      metrics.push(
        await sampleAsyncMetric("M-4", "exact-date-filter", sampleCount, () =>
          measureQuery(page, generated),
        ),
      );
      metrics.push(
        ...(await measureNavigationDirections(page, sampleCount)),
      );
      metrics.push(
        ...(await measureInputDirections(page, sampleCount)),
      );
      metrics.push(
        await sampleAsyncMetric("M-3", "save-buy-trade", sampleCount, () =>
          measureWrite(page),
        ),
      );

      pendingResult = {
        kind: "browser-benchmark",
        status: "completed",
        mode: options.mode,
        scale: options.scale,
        tradeCount: SYNTHETIC_SCALE_TRADE_COUNTS[options.scale],
        samplesPerMetric: sampleCount,
        browserVersion,
        setupMs,
        wrongPasswordRejected: true,
        pickerCalls: await readPickerCalls(context),
        metrics,
        consoleErrors,
      };
    } catch (error) {
      pendingResult = {
        kind: "browser-benchmark",
        status: "setup-failed",
        mode: options.mode,
        scale: options.scale,
        tradeCount: SYNTHETIC_SCALE_TRADE_COUNTS[options.scale],
        stage: error instanceof BenchmarkSetupError ? error.stage : "unknown",
        reason: error instanceof Error ? error.message : String(error),
        consoleErrors,
      };
    }
  } catch (error) {
    pendingResult = {
      kind: "browser-benchmark",
      status: "setup-failed",
      mode: options.mode,
      scale: options.scale,
      tradeCount: SYNTHETIC_SCALE_TRADE_COUNTS[options.scale],
      stage: "infrastructure",
      reason: error instanceof Error ? error.message : String(error),
      consoleErrors,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await stopServer(server);
    await rm(profileDirectory, { recursive: true, force: true });
  }

  await assertRemoved(profileDirectory);
  return { ...pendingResult!, temporaryArtifactsCleaned: true } as BrowserBenchmarkResult;
}

async function createAndImport(
  page: Page,
  baseUrl: string,
  generated: SyntheticLedgerResult,
): Promise<void> {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForAccessChoice(page);
  const choiceButtons = page.locator("main > section button");
  if ((await choiceButtons.count()) < 2) {
    throw new BenchmarkSetupError("create-choice", "Ledger create choice was unavailable");
  }
  await choiceButtons.nth(1).click();
  const createForm = page.locator("main > section form");
  const passwords = createForm.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSPHRASE);
  await passwords.nth(1).fill(PASSPHRASE);
  await createForm.locator('button[type="submit"]').click();
  await waitForWorkspace(page, "home", 60_000);
  await tagBenchmarkSelectors(page);

  await page.locator('[data-benchmark-nav="transfer"]').click();
  await waitForWorkspace(page, "transfer", 30_000);
  const backupInput = page.locator(
    '[data-workspace-page="transfer"] input[type="file"]',
  );
  try {
    await withSyntheticBackupFile(generated, (filePath) =>
      backupInput.setInputFiles(filePath),
    );
  } catch (error) {
    if (error instanceof RangeError && error.message === "Invalid string length") {
      throw new BenchmarkSetupError(
        "backup-serialization",
        `The synthetic backup for ${generated.scale} exceeded the runtime string limit`,
      );
    }
    throw error;
  }

  const confirmation = page.locator(
    '[data-workspace-page="transfer"] button.bg-slate-950',
  );
  try {
    await confirmation.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    throw new BenchmarkSetupError(
      "backup-preflight",
      `The product did not offer import confirmation for ${generated.scale}`,
    );
  }
  if (await confirmation.isDisabled()) {
    throw new BenchmarkSetupError(
      "backup-preflight",
      `The product rejected ${generated.scale} before import confirmation`,
    );
  }
  await confirmation.click();
  await page.waitForFunction(
    () => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-workspace-page="transfer"] input[type="file"]',
      );
      return input !== null && !input.disabled;
    },
    undefined,
    { timeout: 120_000 },
  );
  await page.locator('[data-benchmark-nav="transactions"]').click();
  await waitForWorkspace(page, "transactions", 60_000);
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-workspace-page="transactions"] tbody tr',
        ).length >= 2,
      undefined,
      { timeout: 120_000 },
    );
  } catch {
    throw new BenchmarkSetupError(
      "backup-import",
      "Imported synthetic facts were not rendered by the product",
    );
  }
  await page.locator('[data-benchmark-nav="home"]').click();
  await waitForWorkspace(page, "home", 60_000);
}

async function proveWrongPasswordRejection(
  page: Page,
  baseUrl: string,
): Promise<boolean> {
  await prepareOpenChoice(page, baseUrl);
  await selectExisting(page);
  const form = page.locator("main > section form");
  await form.locator('input[autocomplete="current-password"]').fill(
    "definitely-wrong-password",
  );
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(250);
  const rejected =
    (await page.locator('[data-workspace-page="home"]').count()) === 0 &&
    (await form.locator('input[autocomplete="current-password"]').count()) === 1;
  await form.locator('input[autocomplete="current-password"]').fill(PASSPHRASE);
  await form.locator('button[type="submit"]').click();
  await waitForWorkspace(page, "home", 60_000);
  await tagBenchmarkSelectors(page);
  return rejected;
}

async function measureColdOpen(page: Page, baseUrl: string): Promise<number> {
  await prepareOpenChoice(page, baseUrl);
  const start = performance.now();
  await selectExisting(page);
  const form = page.locator("main > section form");
  await form.locator('input[autocomplete="current-password"]').fill(PASSPHRASE);
  await form.locator('button[type="submit"]').click();
  await waitForWorkspace(page, "home", 120_000);
  await settleFrames(page);
  const duration = performance.now() - start;
  await tagBenchmarkSelectors(page);
  return duration;
}

async function measureQuery(
  page: Page,
  generated: SyntheticLedgerResult,
): Promise<number> {
  await navigate(page, "transactions");
  const dateInput = page.locator(
    '[data-workspace-page="transactions"] input[type="date"]',
  );
  const current = await dateInput.inputValue();
  const next =
    current === generated.todayKey
      ? generated.ledgerData.trades[0].occurredAt.slice(0, 10)
      : generated.todayKey;
  const start = performance.now();
  await dateInput.fill(next);
  await settleFrames(page);
  return performance.now() - start;
}

async function measureNavigationDirections(
  page: Page,
  sampleCount: number,
): Promise<BrowserMetricResult[]> {
  const directions = [
    ["record", "home"],
    ["home", "record"],
    ["record", "transactions"],
    ["transactions", "record"],
  ] as const;
  const results: BrowserMetricResult[] = [];
  for (const [from, to] of directions) {
    results.push(
      await sampleAsyncMetric("M-5", `${from}->${to}`, sampleCount, async () => {
        await navigate(page, from);
        const start = performance.now();
        await navigate(page, to);
        await settleFrames(page);
        return performance.now() - start;
      }),
    );
  }
  return results;
}

async function measureInputDirections(
  page: Page,
  sampleCount: number,
): Promise<BrowserMetricResult[]> {
  await openTradeForm(page);
  const price = page.locator(
    '[data-benchmark-form="trade"] input[inputmode="decimal"]',
  ).nth(1);
  const typeResult = await sampleAsyncMetric(
    "M-6",
    "price-type-character",
    sampleCount,
    async () => {
      await price.fill("");
      const start = performance.now();
      await price.press("3");
      await settleFrames(page);
      return performance.now() - start;
    },
  );
  const deleteResult = await sampleAsyncMetric(
    "M-6",
    "price-delete-character",
    sampleCount,
    async () => {
      await price.fill("3");
      const start = performance.now();
      await price.press("Backspace");
      await settleFrames(page);
      return performance.now() - start;
    },
  );
  return [typeResult, deleteResult];
}

async function measureWrite(page: Page): Promise<number> {
  await openTradeForm(page);
  const form = page.locator('[data-benchmark-form="trade"]');
  const decimalInputs = form.locator('input[inputmode="decimal"]');
  await decimalInputs.nth(0).fill("1");
  await decimalInputs.nth(1).fill("30");
  const start = performance.now();
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-benchmark-form="trade"]')
        ?.getAttribute("aria-busy") === "false",
    undefined,
    { timeout: 120_000 },
  );
  await settleFrames(page);
  return performance.now() - start;
}

async function openTradeForm(page: Page): Promise<void> {
  await navigate(page, "record");
  const target = page
    .locator('[data-workspace-page="record"] select')
    .first();
  await target.selectOption("trade:SIM01");
  await page.evaluate(() => {
    const forms = document.querySelectorAll<HTMLFormElement>(
      '[data-workspace-page="record"] form',
    );
    for (const form of forms) {
      if (form.querySelectorAll('input[inputmode="decimal"]').length >= 3) {
        form.setAttribute("data-benchmark-form", "trade");
        return;
      }
    }
    throw new Error("Benchmark trade form was not found");
  });
}

async function sampleAsyncMetric(
  metric: BrowserMetricResult["metric"],
  operation: string,
  sampleCount: number,
  action: () => Promise<number>,
): Promise<BrowserMetricResult> {
  const discardedWarmupMs = await action();
  const samplesMs: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samplesMs.push(await action());
  }
  return {
    metric,
    operation,
    statistics: summarizeDurations(samplesMs),
    samplesMs: samplesMs.map(roundDuration),
    discardedWarmupMs: roundDuration(discardedWarmupMs),
  };
}

async function navigate(
  page: Page,
  target: "home" | "record" | "transactions" | "transfer",
): Promise<void> {
  await tagBenchmarkSelectors(page);
  await page.locator(`[data-benchmark-nav="${target}"]`).click();
  await waitForWorkspace(page, target, 120_000);
}

async function tagBenchmarkSelectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pages = ["home", "record", "transactions", "transfer", "settings"];
    const buttons = document.querySelectorAll<HTMLButtonElement>("nav button");
    buttons.forEach((button, index) => {
      const pageName = pages[index];
      if (pageName) button.setAttribute("data-benchmark-nav", pageName);
    });
    const lockButton = document.querySelector<HTMLButtonElement>(
      "aside > button",
    );
    lockButton?.setAttribute("data-benchmark-lock", "true");
  });
}

async function prepareOpenChoice(page: Page, baseUrl: string): Promise<void> {
  if ((await page.locator('[data-workspace-page="home"]').count()) > 0) {
    await tagBenchmarkSelectors(page);
    await page.locator('[data-benchmark-lock="true"]').click();
    await page.locator("main > section").waitFor({ state: "visible", timeout: 120_000 });
  }
  await clearRememberedConnection(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (!page.url().startsWith(baseUrl)) await page.goto(baseUrl);
  await waitForAccessChoice(page);
}

async function clearRememberedConnection(page: Page): Promise<void> {
  await page.evaluate(
    async ({ databaseName, storeName, recordKey }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(recordKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    {
      databaseName: CONNECTION_DATABASE,
      storeName: CONNECTION_STORE,
      recordKey: CONNECTION_KEY,
    },
  );
}

async function selectExisting(page: Page): Promise<void> {
  const buttons = page.locator("main > section button");
  await buttons.first().click();
  await page
    .locator('main > section input[autocomplete="current-password"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForAccessChoice(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const section = document.querySelector("main > section");
      return section !== null && section.querySelectorAll("button").length >= 2;
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function ensureUnlocked(page: Page): Promise<void> {
  await page.locator('[data-workspace-page="home"]').waitFor({
    state: "visible",
    timeout: 120_000,
  });
}

async function waitForWorkspace(
  page: Page,
  workspace: string,
  timeout: number,
): Promise<void> {
  await page.locator(`[data-workspace-page="${workspace}"]`).waitFor({
    state: "visible",
    timeout,
  });
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function startNextServer(mode: BrowserBenchmarkMode, port: number): ChildProcess {
  const nextCli = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [nextCli, mode === "dev" ? "dev" : "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

async function stopServer(server: ChildProcess | undefined): Promise<void> {
  if (!server?.pid || server.exitCode !== null) return;
  try {
    if (process.platform === "win32") server.kill("SIGTERM");
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a benchmark port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next server did not become ready at ${url}`);
}

async function assertRemoved(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Temporary benchmark path was not removed: ${path}`);
}

function defaultSampleCount(scale: SyntheticScale): number {
  if (scale === "S-1M") return 1;
  if (scale === "S-100K") return 3;
  return 10;
}

function parseArguments(argv: readonly string[]): RunBrowserBenchmarkOptions {
  let mode: BrowserBenchmarkMode = "dev";
  let scale: SyntheticScale = "S-100";
  let sampleCount: number | undefined;
  let headless = true;
  let channel: "chrome" | "chromium" = "chrome";

  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    if (name === "--mode" && (value === "dev" || value === "production")) {
      mode = value;
    } else if (name === "--scale" && value && value in SYNTHETIC_SCALE_TRADE_COUNTS) {
      scale = value as SyntheticScale;
    } else if (name === "--samples" && value !== undefined) {
      sampleCount = Number.parseInt(value, 10);
    } else if (name === "--headed") {
      headless = false;
    } else if (name === "--channel" && (value === "chrome" || value === "chromium")) {
      channel = value;
    } else {
      throw new Error(`Unsupported browser benchmark argument: ${argument}`);
    }
  }
  return { mode, scale, sampleCount, headless, channel };
}

class BenchmarkSetupError extends Error {
  constructor(readonly stage: string, message: string) {
    super(message);
    this.name = "BenchmarkSetupError";
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runBrowserBenchmark(parseArguments(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
