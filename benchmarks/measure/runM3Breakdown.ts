import { pathToFileURL } from "node:url";

import { runM3BreakdownBenchmark } from "./browserMetrics";

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runM3BreakdownBenchmark()
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
