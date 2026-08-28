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

The normal `npm test` configuration includes only `src/**/*.test.{ts,tsx}`;
benchmark contracts use `*.contract.ts` and therefore never join the default
test suite.
