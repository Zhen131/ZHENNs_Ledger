# Performance benchmarks

This directory contains synthetic-ledger generators and performance rulers for
the unmodified product. Nothing under `src/` is changed by the benchmark suite.

The generator uses the fixed default seed `w15-main-perf-baseline-v1` and the
fixed synthetic date `2026-08-28`. The five supported scales are `S-100`,
`S-1K`, `S-10K`, `S-100K`, and `S-1M`. Symbols such as `SIM01` are deliberately
fictional. Generated ledgers and reports are temporary runtime artifacts and
must never be committed.

Run the generator contract independently:

```sh
npm run bench:test:generator
```

Run the Node ruler contract or one real scale:

```sh
npm run bench:test:node
npm run bench:node -- --scale=S-100
```

`bench:node` measures the five derivations executed by `DashboardShell` as
M-2, holding-history construction for `1d`, `7d`, `30d`, `365d`, and `all` as
M-7, and one position-plus-cash replay as M-8. The first execution of every
metric is discarded. The JSON output includes every retained sample and its
median, minimum, maximum, and count. `--metric=M-7 --range=365d` can isolate a
potentially expensive operation so a caller can enforce an external timeout.

Run the browser ruler in development or production mode:

```sh
npx playwright install chromium
npm run bench:browser -- --mode=dev --scale=S-100
npm run build
npm run bench:browser -- --mode=production --scale=S-100
```

Break down one production S-10K M-3 write without changing `src/`:

```sh
npm run build
npm run bench:m3-breakdown
```

The breakdown is deliberately `n=1`. It combines a Chrome CPU profile with
benchmark-only wrappers around large JSON serialization, Web Crypto, and OPFS
read/write operations. Production-minified derivation functions are identified
from semantic markers in the built chunk and CDP call-frame positions. Rendering
time comes from Chrome timeline events. The persistence wall-clock interval can
overlap derivation work, so the report preserves the signed difference between
the three segment totals and the outer M-3 duration instead of allocating it.

The current baseline uses installed stable Chrome (`--channel=chrome`). A
standalone Playwright Chromium can be selected with `--channel=chromium` after
installing its binary separately. The ruler injects picker replacements before
page scripts run and returns an OPFS `FileSystemFileHandle` owned by the
temporary browser profile. Only the operating-system dialog is replaced;
password checks, KDF, encryption, decryption, file writes, readback, schema
checks, backup import, and product rendering remain real. The profile and its
encrypted synthetic ledger are removed after every run.

Element lookup never depends on Chinese UI wording. Existing stable workspace
attributes, native element roles/types, form structure, and benchmark-only
attributes injected from navigation order are used instead.

Probe one generated scale without writing a ledger or result file:

```sh
npm run bench:probe -- --scale=S-100K
```

The probe reports generation time, full product Validator outcome, position and
cash replay time, serialized backup bytes, and resident memory after the probe.

The normal `npm test` configuration includes only `src/**/*.test.{ts,tsx}`;
benchmark contracts use `*.contract.ts` and therefore never join the default
test suite.
