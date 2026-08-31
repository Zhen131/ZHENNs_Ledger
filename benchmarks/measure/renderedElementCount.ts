import { pathToFileURL } from "node:url";

import {
  runRenderedElementCountBenchmark,
  type BrowserBenchmarkMode,
} from "./browserMetrics";
import {
  SYNTHETIC_SCALE_TRADE_COUNTS,
  type SyntheticScale,
} from "../generator/syntheticLedger";

function parseArguments(argv: readonly string[]) {
  let mode: BrowserBenchmarkMode = "production";
  let scale: SyntheticScale = "S-100";
  let headless = true;
  let channel: "chrome" | "chromium" = "chrome";

  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    if (name === "--mode" && (value === "dev" || value === "production")) {
      mode = value;
    } else if (name === "--scale" && value && value in SYNTHETIC_SCALE_TRADE_COUNTS) {
      scale = value as SyntheticScale;
    } else if (name === "--headed") {
      headless = false;
    } else if (name === "--channel" && (value === "chrome" || value === "chromium")) {
      channel = value;
    } else {
      throw new Error(`Unsupported M-9 benchmark argument: ${argument}`);
    }
  }
  return { mode, scale, headless, channel };
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runRenderedElementCountBenchmark(parseArguments(process.argv.slice(2)))
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
