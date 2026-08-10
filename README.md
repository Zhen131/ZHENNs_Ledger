# Local-First Personal Trading Ledger

A browser-based personal trading ledger built with Next.js, React, and TypeScript. The `main` branch is the long-term product line for real personal use. Its Chinese user interface is an intentional product choice; public documentation, release notes, and new commit subjects are maintained in English.

The supervisor-facing thesis line lives on the [`CS2026` branch](https://github.com/Zhen131/ZHENNs_Ledger/tree/CS2026). The immutable split point is tagged `CS2026-baseline-2026-08-02`.

## Branch policy

| Branch | Purpose | Language policy |
| --- | --- | --- |
| `main` | Long-term personal ledger product | Chinese UI is allowed; public documentation and new commit subjects are English. |
| `CS2026` | 2026 graduation thesis implementation and evidence | The tracked working tree and all future commit subjects are English. |

The branches are independent long-lived lines. Do not merge, rebase, cherry-pick, copy fixes, or edit both lines automatically. Cross-branch reuse requires an explicit user decision after the relevant weekly log records the observation.

## Current status

The current browser implementation uses Next `15.5.22`, React / React DOM `19.2.8`, ESLint `9.39.5`, and `eslint-config-next` `15.5.22`. `LedgerData.schemaVersion` remains `1`.

The normal product path stores the ledger in a user-selected encrypted `.lftl` file, called C in the project contracts. Legacy IndexedDB V2 data is no longer the normal entry point; when a complete legacy ledger is detected, the user must unlock it, migrate it to a new C, verify the new file, and explicitly confirm deletion of the legacy record.

Week 11 evidence is deliberately separated into implemented behavior and independent acceptance:

- Batch 1 passed the final independent review. FILE-001, FILE-002, FILE-004, and FILE-005 cover the `.lftl` V1 contract, one selected handle, current and previous encrypted generations, close-and-read-back verification, and the C session capability boundary.
- Batch 2 implemented C takeover, previous-generation recovery, single-writer coordination, reconnect, password lifecycle, legacy migration, and safe clear. Its development and independent automated checks passed with 51 test files and 596 tests, but `02D` remains `BLOCKED` because the required real Chrome picker, permission, dual-tab, and raw IndexedDB evidence was incomplete.
- Batch 3 implemented full plaintext backup export, zero-write preflight, structured error reporting, suspicious-duplicate grouping, and whole-ledger import into a newly created empty C. Development finished with 55 test files and 698 tests, and the normal real-Chrome success path passed. `03B` remains `BLOCKED` because a browser cannot guarantee rollback after process death, permanent permission loss, or an external write that wins after close. `03C` and `03D` were not executed.

The Week 12 fee-aware P&L candidate is intentionally retained on the local `zhennn/w12-pnl-fee-accounting` branch and is not merged into `main`. The original independent `01D` review failed on one P0: loading an otherwise valid legacy USD asset without `binanceMapping` could silently persist a default mapping. The R1 candidate now preserves absent, explicit `null`, and explicit mapping objects as distinct stored facts, while a read-only runtime resolver supplies built-in defaults only where Binance behavior needs them. Its current automated development validation passes 58 test files and 730 tests, typecheck, lint, production build, and whitespace checks. A dedicated fictional legacy USD `.lftl` also passed the development-side real-Chrome import, authenticated write/readback, lock/reopen, export, and exact `LedgerData` comparison flow without materializing the absent BTC mapping. A fresh `01R1D` review is still required, so this remains a development candidate rather than an accepted `main` release.

Merging code or passing automated tests does not turn a blocked independent acceptance result into `PASS`.

## Implemented capabilities

- Buy and sell entry with validation, deterministic business ordering, full-timeline oversell protection, and safe deletion.
- DCA quantity, fee-aware average cost and cost basis, net realized P&L, latest price, market value, and net unrealized P&L derived from ledger facts.
- Manual price snapshots and on-demand Binance latest-price refresh with an eight-second timeout, no retry, no polling, and no WebSocket.
- One shared price-selection policy for the positions table, allocation chart, and historical value curve.
- Three fact-derived charts: current USDT / legacy-USD-equivalent allocation, market-value and fee-aware cost-basis step history, and a 365-day activity heatmap.
- Strict future-fact handling: new future facts are rejected; existing future facts enter a restricted correction mode.
- Runtime validation for forms, stored data, backup input, ISO dates, references, decimal strings, uniqueness, and the complete trade timeline.
- PBKDF2-SHA-256 with 600,000 iterations and a non-extractable AES-256-GCM session key for encrypted storage.
- Passwords and `CryptoKey` objects remain session-only; refresh or close requires another unlock.
- User-selected `.lftl` storage with current and previous encrypted generations, revision lineage, close-and-read-back verification, reconnect, and fail-closed permission handling.
- Web Locks, file-entry identity checks, a page lease, a short write lock, and revision re-reading to reduce conflicting browser-tab writes.
- Plaintext `BackupEnvelopeV1` export and validated whole-ledger restore. Backups remain sensitive plaintext files.
- Zero-write backup preflight, SHA-256 content identity, hard-error reporting, suspicious duplicate groups, and no automatic merge or deduplication.
- Dirty, pending, retry, leave-warning, repository-generation, and stale-async-result protections around persistence.
- `ResourcePolicy` limits for file bytes, entities, and critical string lengths.
- Responsive wide-table containment and keyboard, pointer, visibility, and reduced-motion handling for destructive controls.

## Data and security invariants

- `Trade`, `PriceSnapshot`, assets, fee rules, and Binance mappings are facts.
- An absent Binance mapping remains absent in storage and exports; runtime fallback does not mutate `LedgerData`. Explicit `null` remains a durable user disable, while an explicit mapping object remains exact.
- `Position[]`, chart slices, chart points, heat levels, valuation mode, and selected date are derived or session state. They are not persisted in `LedgerData`, C, connection records, or backups.
- `Trade.totalValue` is the fee-exclusive execution amount. Actual buy fees in the accounting currency increase replayed cost; actual sell fees in that currency reduce net proceeds and realized P&L.
- A non-zero fee in another currency is never treated as zero and is never guessed as USDT. Fee-sensitive cost and P&L are withheld with an explicit reliability issue until a conversion contract exists.
- Quantity and money calculations use `DecimalString -> decimal.js`; ledger calculations do not rely on JavaScript floating-point arithmetic.
- Untrusted form, IndexedDB, file, and JSON input crosses a runtime validator before entering application state.
- Missing market data remains missing. The application does not substitute trade price, cost, future data, or zero.
- Binance is an optional and fallible external input. Network failure does not block the local ledger.
- UI components, services, and reducers do not directly operate IndexedDB or the File System Access API.
- Legacy IndexedDB whole-blob storage uses AES-256-GCM. Normal ledger data lives in C; IndexedDB retains only the minimal C connection record.
- A backup is plaintext and outside the encrypted-at-rest guarantee. The UI must disclose download location and synced-folder risk before export.
- A successful import equals the frozen and validated backup candidate as a whole. It does not merge, partially import, skip errors, or automatically deduplicate.
- If browser compensation cannot prove the resulting disk state, the repository fails closed instead of guessing whether the old or new ledger won.
- Browser tab coordination is not an operating-system file lock and cannot control native applications that do not participate in the protocol.

## Main flows

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

Market data and valuation:

```text
MarketDataControls
-> BinanceMarketDataClient(exchangeInfo + ticker/price)
-> binancePriceRefreshService(per-asset results + same-day upsert)
-> LedgerData.priceSnapshots
-> priceSelectionService.selectPriceAsOf(...)
-> positions table / allocation chart / history chart
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
  backup/        BackupEnvelopeV1, canonical serialization, preflight, and download
  components/    Access gate, dashboard, market data, charts, backup, and fact forms
  marketData/    Binance public REST client, response validation, and timeout
  models/        Asset, Trade, PriceSnapshot, Position, LedgerData, and related types
  utils/         Shared decimal and date utilities
  calculators/   Pure replay, cost, holdings, and P&L calculations
  policies/      New-fact, import, date, currency, and future-fact boundaries
  validators/    Trade, price, ISO date, resource, and full-ledger validation
  services/      Fact writes, market refresh, price selection, positions, and charts
  state/         Initial ledger, reducer, replace, and hydration state
  repositories/  Whole-ledger load, save, clear, migration, and validation boundaries
  encryption/    IndexedDB V2 and .lftl contracts, Base64URL, PBKDF2, and AES-GCM
  adapters/      Legacy IndexedDB, C connection records, and file handles
  coordination/  Cross-page lease and short write lock for the same C
  composition/   Legacy migration and normal C composition roots
  test/          Shared deterministic fixtures
```

## Local development

Use Node.js 20, 22, or 24+. Project scripts bind to the loopback interface by default.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

Run the complete local quality gate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

The current R1 development baseline reports 58 test files and 730 passing tests, plus typecheck, lint, production build, whitespace checks, and the dedicated fictional-file real-Chrome flow described above. That result remains development evidence, not a replacement for fresh `01R1D` independent review or the blocked Week 11 browser contracts described above.

## Known limits and deferred work

- Actual fees are included only when they are already denominated in the relevant accounting currency. Fee-rule automation, platform-specific fee policy, and cross-currency fee conversion are not implemented.
- Position-adjustment transactions and the originally proposed transaction-marker overlay are not implemented.
- Binance provides latest public prices only. Historical Kline/OHLC, polling, and WebSocket feeds are not implemented.
- Exported backups remain plaintext.
- `02D` and `03B` remain `BLOCKED` under their independent acceptance contracts.
- The current browser compensation flow is not an operating-system atomic transaction.
- Mac desktop architecture is a product discussion direction, not implemented code.
- Pagination, virtual lists, and large-ledger performance budgets await a defined benchmark. Do not claim that 25,000 trades are smooth without measured evidence.
- The thesis branch still needs its deterministic generator, Playwright harness, four performance metrics, repeated-run statistics, seven-ideal evaluation, and publication-quality evidence.

## Release history boundary

The Week 10 feature baseline is `5a21529c10d4a27048e4d26d07c7a1641e4c7b87`. The current pre-split source baseline is `084ae7da96770721e9e805658928a7884eed779c`, preserved by `CS2026-baseline-2026-08-02`.

Use Git as the source of truth for current branch, remote, and release state. This README does not preserve stale claims about unmerged local candidates.
