import type { BrowserContext } from "playwright";

export type BenchmarkPickerCalls = Readonly<{
  save: number;
  open: number;
}>;

export async function installFilePickerStub(
  context: BrowserContext,
  fileName = "synthetic-benchmark.lftl",
): Promise<void> {
  const benchmarkFileName = JSON.stringify(fileName);
  await context.addInitScript({
    content: `(() => {
      const benchmarkFileName = ${benchmarkFileName};
      const storageKey = "lftl-benchmark-picker-calls";
      let storedCalls = { save: 0, open: 0 };
      try {
        storedCalls = JSON.parse(localStorage.getItem(storageKey)) ?? storedCalls;
      } catch {}
      globalThis.__lftlBenchmarkPickerCalls = storedCalls;
      function persistCalls() {
        localStorage.setItem(
          storageKey,
          JSON.stringify(globalThis.__lftlBenchmarkPickerCalls),
        );
      }
      async function getBenchmarkHandle() {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(benchmarkFileName, { create: true });
        if (typeof handle.queryPermission !== "function") {
          Object.defineProperty(handle, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (typeof handle.requestPermission !== "function") {
          Object.defineProperty(handle, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      }
      Object.defineProperty(globalThis, "showSaveFilePicker", {
        configurable: true,
        value: async () => {
          globalThis.__lftlBenchmarkPickerCalls.save += 1;
          persistCalls();
          return getBenchmarkHandle();
        },
      });
      Object.defineProperty(globalThis, "showOpenFilePicker", {
        configurable: true,
        value: async () => {
          globalThis.__lftlBenchmarkPickerCalls.open += 1;
          persistCalls();
          return [await getBenchmarkHandle()];
        },
      });
    })();`,
  });
}

export async function readPickerCalls(
  context: BrowserContext,
): Promise<BenchmarkPickerCalls> {
  const pages = context.pages();
  const page = pages.at(-1);
  if (!page) return { save: 0, open: 0 };
  return page.evaluate(() => {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __lftlBenchmarkPickerCalls?: BenchmarkPickerCalls;
    };
    return benchmarkGlobal.__lftlBenchmarkPickerCalls ?? { save: 0, open: 0 };
  });
}
