import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { replayPositions, replayUsdtCash } from "@/core/calculations";
import { validateLedgerData } from "@/core/validation";

import {
  generateSyntheticLedger,
  serializeSyntheticBackup,
  SYNTHETIC_SCALE_TRADE_COUNTS,
  type SyntheticScale,
} from "../generator/syntheticLedger";
import { roundDuration } from "./report";

export type ScaleProbeResult = Readonly<{
  kind: "synthetic-scale-probe";
  scale: SyntheticScale;
  tradeCount: number;
  generatedFactCount: number;
  generationMs: number;
  validation: Readonly<{
    ok: boolean;
    durationMs: number;
    firstError?: string;
  }>;
  replay: Readonly<{
    positionMs: number;
    cashMs: number;
  }>;
  backup:
    | Readonly<{
        status: "completed";
        serializationMs: number;
        utf8Bytes: number;
      }>
    | Readonly<{
        status: "failed";
        serializationMs: number;
        reason: string;
      }>;
  rssBytesAfterProbe: number;
}>;

export function runScaleProbe(scale: SyntheticScale): ScaleProbeResult {
  const generationStart = performance.now();
  const generated = generateSyntheticLedger({ scale });
  const generationMs = performance.now() - generationStart;
  const { ledgerData } = generated;

  const validationStart = performance.now();
  const validation = validateLedgerData(ledgerData);
  const validationMs = performance.now() - validationStart;

  const positionStart = performance.now();
  replayPositions(ledgerData.trades, ledgerData.assetTransfers);
  const positionMs = performance.now() - positionStart;
  const cashStart = performance.now();
  replayUsdtCash(ledgerData);
  const cashMs = performance.now() - cashStart;

  const serializationStart = performance.now();
  let backup: ScaleProbeResult["backup"];
  try {
    const serialized = serializeSyntheticBackup(generated);
    backup = {
      status: "completed",
      serializationMs: roundDuration(performance.now() - serializationStart),
      utf8Bytes: Buffer.byteLength(serialized, "utf8"),
    };
  } catch (error) {
    backup = {
      status: "failed",
      serializationMs: roundDuration(performance.now() - serializationStart),
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  return {
    kind: "synthetic-scale-probe",
    scale,
    tradeCount: SYNTHETIC_SCALE_TRADE_COUNTS[scale],
    generatedFactCount:
      ledgerData.assets.length +
      ledgerData.trades.length +
      ledgerData.cashEvents.length +
      ledgerData.assetTransfers.length +
      ledgerData.priceSnapshots.length +
      ledgerData.feeRules.length,
    generationMs: roundDuration(generationMs),
    validation: {
      ok: validation.ok,
      durationMs: roundDuration(validationMs),
      ...(!validation.ok
        ? { firstError: validation.errors[0]?.message ?? "unknown validation error" }
        : {}),
    },
    replay: {
      positionMs: roundDuration(positionMs),
      cashMs: roundDuration(cashMs),
    },
    backup,
    rssBytesAfterProbe: process.memoryUsage().rss,
  };
}

function parseScale(argv: readonly string[]): SyntheticScale {
  const argument = argv.find((value) => value.startsWith("--scale="));
  const scale = argument?.slice("--scale=".length);
  if (!scale || !(scale in SYNTHETIC_SCALE_TRADE_COUNTS)) {
    throw new Error(
      `--scale must be one of ${Object.keys(SYNTHETIC_SCALE_TRADE_COUNTS).join(", ")}`,
    );
  }
  return scale as SyntheticScale;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(runScaleProbe(parseScale(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
