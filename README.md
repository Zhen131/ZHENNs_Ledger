# CS2026 Local-First Trading Ledger Thesis

This branch contains the supervisor-facing implementation and evidence for the 2026 graduation thesis. It starts from the immutable source baseline `084ae7da96770721e9e805658928a7884eed779c`, tagged `CS2026-baseline-2026-08-02`.

The long-term personal product remains on `main`. `CS2026` is an independent long-lived thesis line and is not intended to be merged wholesale into `main`.

## Branch contract

- Keep the tracked working tree, public documentation, release notes, UI copy, source comments, tests, fixtures, and new commit subjects in English.
- Keep historical commit messages unchanged. The history before the split intentionally contains Chinese subjects.
- Do not merge, rebase, cherry-pick, copy fixes, or edit `main` automatically.
- Record a potentially reusable finding in the outer weekly log. Reuse it only after an explicit user decision.
- Preserve implemented behavior and compatibility while translating the branch. Language migration must not change `LedgerData`, backup, or `.lftl` schemas.

## Thesis baseline and current evidence

The application is a browser-based local-first personal trading ledger built with Next.js, React, TypeScript, Tailwind CSS, Apache ECharts, Vitest, the Web Crypto API, IndexedDB, and the File System Access API.

The implementation has reached a late product stage, but the thesis evaluation layer is not complete. The current distinction is:

- Core ledger functionality exists: buy and sell entry, DCA replay, holdings, cost basis, realized and unrealized P&L, validation, encrypted local storage, backup import and export, and three charts.
- The normal product path uses a user-selected encrypted `.lftl` file. Legacy encrypted IndexedDB data remains available only as a controlled migration source.
- The thesis still lacks its deterministic workload generator, Playwright performance harness, four required metrics, repeated-run statistics, seven local-first-ideal assessment, publication-quality benchmark figures, structured walkthrough evidence, CI workflow, license, and final release.

Week 11 acceptance boundaries remain part of the evidence:

- Batch 1 passed final independent review. FILE-001, FILE-002, FILE-004, and FILE-005 cover the `.lftl` V1 contract, selected handle, current and previous encrypted generations, close-and-read-back verification, and C capability boundary.
- Batch 2 completed development and automated review with 51 test files and 596 tests. `02D` remains `BLOCKED` because required real Chrome picker, permission, dual-tab, and raw IndexedDB evidence was incomplete.
- Batch 3 completed development with 55 test files and 698 tests and passed the normal real-Chrome success path. `03B` remains `BLOCKED` because a browser cannot guarantee rollback after process death, permanent permission loss, or a winning external write after close. `03C` and `03D` were not executed.

Passing tests or merging implementation code does not turn a blocked independent acceptance result into `PASS`.

## Implemented application capabilities

- Buy and sell entry with validation, full-timeline oversell protection, and safe deletion.
- DCA quantity, average cost, cost basis, realized P&L, latest price, market value, and unrealized P&L derived from ledger facts.
- Manual price snapshots and on-demand Binance latest-price refresh with timeout, no retry, no polling, and no WebSocket.
- One price-selection policy shared by the positions table, allocation chart, and historical value curve.
- Three derived charts: current USD-equivalent allocation, market-value and cost-basis step history, and a 365-day activity heatmap.
- Runtime validation for forms, stored data, backups, ISO dates, references, decimal strings, uniqueness, and the complete trade timeline.
- PBKDF2-SHA-256 with 600,000 iterations and a non-extractable AES-256-GCM session key.
- User-selected `.lftl` storage with current and previous encrypted generations, revision lineage, close-and-read-back verification, reconnect, and fail-closed permission handling.
- Browser-tab coordination with Web Locks, file-entry identity checks, a page lease, a short write lock, and revision re-reading.
- Plaintext `BackupEnvelopeV1` export, zero-write preflight, SHA-256 content identity, hard-error reporting, suspicious duplicate groups, and validated whole-ledger restore.
- Dirty, pending, retry, leave-warning, generation, and stale-async-result protections around persistence.
- Resource limits for bytes, entity counts, and critical string lengths.

## Data and security invariants

- `Trade`, `PriceSnapshot`, assets, fee rules, and Binance mappings are facts.
- `Position[]`, chart data, heat levels, valuation mode, and selected date are derived or session state and are not persisted.
- Quantity and money calculations use `DecimalString -> decimal.js` instead of JavaScript floating-point ledger arithmetic.
- Untrusted form, IndexedDB, file, and JSON input crosses a runtime validator before entering application state.
- Missing market data remains missing; it is not replaced with trade price, cost, future data, or zero.
- Binance is optional and fallible. Network failure does not block the local ledger.
- Passwords and non-extractable keys remain in the current session only.
- Backups are plaintext sensitive files and are outside the encrypted-at-rest guarantee.
- Import success means the complete ledger equals the frozen and validated backup candidate. The system does not merge, partially import, skip errors, or automatically deduplicate.
- If compensation cannot prove the resulting disk state, the repository fails closed.
- Browser coordination is not an operating-system file lock or atomic file-replacement transaction.

## Main data flows

Trade entry:

```text
TradeForm
-> createValidatedTrade(...)
-> validateTradeDraft(...)
-> dispatch(trade/add)
-> LedgerData.trades
-> positionService
-> positionCalculator
-> trade list and positions
```

Normal C startup and persistence:

```text
page
-> LedgerAccessGate
-> create / select / reconnect C
-> file session lease + identity / revision
-> setup / unlock
-> PBKDF2 + non-extractable CryptoKey
-> DashboardShell(required repository)
-> usePersistentLedger
-> LedgerFileRepository
-> LedgerFileHandleAdapter
-> user-selected .lftl file
```

Legacy IndexedDB migration:

```text
IndexedDB StoredLedgerEnvelopeV2
-> unlock and fully validate legacy LedgerData
-> create C and complete write / close / read-back / identity checks
-> explicit user confirmation
-> conditional deletion of the legacy record
```

## Source layout

```text
src/
  app/           Next.js entry points
  backup/        Backup envelope, serialization, preflight, report, and download
  components/    Access gate, dashboard, market data, charts, backup, and fact forms
  marketData/    Binance public REST client, response validation, and timeout
  models/        Ledger fact, draft, position, and aggregate types
  utils/         Decimal and date utilities
  calculators/   Pure holdings, cost, and P&L calculations
  policies/      Fact, import, date, currency, and future-data boundaries
  validators/    Trade, price, ISO date, resource, and full-ledger validation
  services/      Fact writes, refresh, selection, positions, and charts
  state/         Initial ledger, reducer, replacement, and hydration
  repositories/  Whole-ledger persistence, migration, clear, and validation
  encryption/    IndexedDB V2 and .lftl contracts, PBKDF2, and AES-GCM
  adapters/      IndexedDB, connection-record, and file-handle adapters
  coordination/  Page lease and short write lock for the same C
  composition/   Access and persistence composition roots
  test/          Shared deterministic fixtures
```

## Local development

Use Node.js 20, 22, or 24+. Project scripts bind to loopback by default.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

Run the complete quality gate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

## Thesis gaps and limits

- Fees are stored but are not yet included in net realized or unrealized P&L.
- Position-adjustment transactions and the originally proposed transaction-marker overlay are not implemented.
- The original thesis named IndexedDB as primary storage, Recharts, Shadcn/UI, and Next.js 14. The current implementation uses a selected `.lftl` file, Apache ECharts, custom components, and Next.js 15. These scope changes require explicit thesis documentation and supervisor confirmation where they affect the research object.
- Deterministic workloads of 100, 1,000, 10,000, and 100,000 trades are not implemented.
- Playwright benchmark automation and the required write, query, full-portfolio P&L, and cold-start metrics are not implemented.
- Ten-run median and interquartile-range results, performance-degradation figures, misuse-risk figures, and the structured seven-ideal assessment are not implemented.
- GitHub Actions CI, a reproducible benchmark command, a license, a tagged thesis release, and the final supervisor-facing evidence package are not yet present.
- `02D` and `03B` remain `BLOCKED` under their independent acceptance contracts.
- Mac desktop architecture is not part of the current implemented thesis branch.

This README reports current evidence only. It does not treat planned work as implemented work.
