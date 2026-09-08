# Local-First Trading Ledger

## What this is

A personal trading ledger that keeps everything in one encrypted file you choose.

There is no account, no server, and no sync. The complete ledger lives in a single
`.lftl` file on your own disk, encrypted with a password only you know. The browser
remembers which file you last opened and a little connection information; it never
keeps a second copy of the ledger.

Everything the app shows — holdings, profit and loss, charts — is derived on the fly
from the facts you recorded. Nothing derived is stored, so a derived number can never
drift away from the facts behind it.

## Core trade-offs

**One file is the ledger of record.** If that file is lost, the ledger is lost. In
exchange, nobody else ever holds your trading history, and the app cannot silently
substitute a different ledger for the one you picked.

**Facts in, everything else derived.** Only what actually happened is stored: assets,
trades, cash events, asset transfers, price snapshots, and fee rules. Positions, cost
basis, and profit and loss are recomputed from those, never written down.

**A refusal beats a guess.** When a number cannot be computed honestly — a missing
price, a fee in a currency that cannot be converted — the interface says so instead of
filling in a zero. Historical rules are superseded by new versions rather than edited
in place.

**Safety over convenience at every gate.** Writes go through explicit authorization and
are read back and verified afterwards. A file from an older format or schema is refused
outright rather than migrated, so a wrong guess can never quietly damage your data.

**The network is opt-in.** The app reaches out only when you click validate or refresh,
and such a request carries nothing but a public trading pair symbol.

## What it does today

- **Record the facts.** Trades, USDT cash events, asset transfers in and out between
  places you hold assets, and manual price snapshots. A negative cash balance can be
  saved, but only after a second confirmation that shows the shortfall.
- **See the position.** Total assets, remaining cost basis, realized and unrealized
  profit and loss, and a holdings table with average cost basis per asset.
- **Charts.** An allocation pie, a daily step line for total assets against cost basis,
  and a 365-day trade activity heatmap you can click to filter the activity list.
- **One unified activity list.** Trades and cash facts on one timeline, filterable by
  time range, exact date, asset, and type, with a five-second undo window on deletion.
- **Fee rules.** Named rules matched to a platform, versioned rather than edited, with
  the matched rule recorded as the source of a trade's fee.
- **Binance market data.** Map an asset to a Binance Spot trading pair, validate it, and
  refresh prices for mapped non-zero holdings on demand.
- **Plaintext backups.** Export the whole ledger as JSON, or import one after a
  read-only preflight that reports hard errors and suspicious duplicates. An import
  replaces the ledger completely; it never merges.
- **Chinese and English interface**, switchable in settings and remembered per browser.

Current formats: ledger schema version 5, ledger file format version 3, crypto version
1, backup format version 3.

Encryption is AES-GCM with a 256-bit key and a 128-bit tag, over a key derived with
PBKDF2-SHA-256 at 600,000 iterations and a per-file salt.

## Source layout

`src/` holds six areas, and each area has a stable entry point that the rest of the
code imports through:

| Area | What lives there |
| --- | --- |
| `src/core` | Pure domain logic, no I/O and no React: `calculations`, `catalog`, `models`, `policies`, `shared`, `state`, `validation` |
| `src/platform` | Everything that touches the outside world: `coordination`, `encryption`, `files`, `integrations`, `legacy`, `persistence` |
| `src/features` | One flat folder per feature surface, each with its own logic and UI entry: `activity`, `asset-transfers`, `assets`, `backup`, `cash`, `charts`, `fees`, `market-data`, `portfolio`, `prices`, `trades` |
| `src/app` | The Next.js app router entry, the dashboard shell, and the workspaces that compose features |
| `src/ui` | Shared presentation pieces, number formatting, and the message tables for both languages |
| `src/test-support` | Fixtures and the guards that hold the layout, the wording, and the translations in place |

`benchmarks/` holds the synthetic-ledger generator and the performance probes.
`test-fixtures/golden/` holds frozen sample files that must never be edited; they are
the only evidence of what older formats looked like.

The layout itself is enforced by a test: areas may not import each other's internals,
no area may import its own entry point, and the dependency graph must stay acyclic.

## Running it locally

Requires Node.js and npm, and a Chromium-based browser — the ledger file is opened
through the File System Access API, which other browsers do not implement.

```bash
npm install
npm run dev
```

`npm run dev` serves on `127.0.0.1` only. Open it, create a ledger, and choose where the
`.lftl` file goes.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on `127.0.0.1` |
| `npm run build` | Production build |
| `npm run start` | Serve the production build on `127.0.0.1` |
| `npm test` | The whole test suite once |
| `npm run test:watch` | The test suite in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, warnings treated as failures |

Benchmarks are separate and each has a contract test beside it:
`bench:test:generator`, `bench:test:node`, `bench:node`, `bench:test:browser`,
`bench:browser`, `bench:test:m9`, `bench:m9`, `bench:m3-breakdown`, `bench:probe`.

## Limits at this stage

- **This is Alpha.** Formats and behaviour can still change, and there is no upgrade
  path promised between Alpha revisions.
- **Older files are refused, not migrated.** A ledger file or backup written against an
  earlier schema or container version is rejected before the password is even used. No
  migration is provided, and the original file is left untouched.
- **The interface switches between Chinese and English, but the English has not been
  reviewed by a native speaker.** Domain terms are pinned by a glossary the tests
  enforce; tone and idiom are not vouched for. The English layout has not been checked
  page by page either, so longer English labels may crowd a table or a button.
- **Hungarian is unfinished and withdrawn.** The language code and its translations are
  still in the source so it can return in one line, but the option is not offered in
  settings, and a browser that stored it falls back to the default language.
- **One file, one person, one machine.** There is no sync, no sharing, and no
  multi-device story. Two pages open on the same file coordinate to avoid corrupting
  it, but that is a safety measure, not collaboration.
- **Backups are plaintext.** An exported backup is unencrypted JSON, readable by anyone
  who can reach the file. Keep it somewhere safe, and remember that a sync folder may
  upload it on its own.
- **Prices are only as good as what you record.** Automatic prices come from Binance
  Spot for assets you mapped yourself; everything else needs a manual price, and
  without one the affected numbers are reported as uncomputable rather than guessed.

## Where your data lives

Two kinds of file, with completely different jobs.

| | The ledger file (`.lftl`) | A backup file (`.json`) |
| --- | --- | --- |
| What it is for | The ledger of record you work in every day | Backup, moving to another machine, reading it yourself |
| Encryption | AES-GCM, 256-bit key, 128-bit tag | **None. It is plaintext.** |
| Where it goes | Wherever you point the system file picker | Wherever you choose to export it |
| How it is protected | Two generations kept side by side, every write read back and verified, and the file's identity checked before it is trusted | Identified by the SHA-256 of its contents, and inspected by a read-only preflight before any import writes anything |

The password never leaves the page, and neither does the key derived from it. The key
comes from PBKDF2-SHA-256 at 600,000 iterations over a salt stored in that one file, so
two ledgers with the same password still have different keys. Both the password and the
key exist only for as long as the tab is unlocked; closing or reloading the page means
unlocking again.

Inside the ledger file, two generations are kept: the current one and the previous one.
A write lands in the inactive generation and is read back and verified before it counts,
so an interrupted write leaves the last good generation intact.

What the browser stores locally is deliberately small, and none of it is your ledger:

- **IndexedDB** holds exactly one record — the file handle the browser gave you for the
  ledger file, plus the file identity it expects to find there. No ledger contents, no
  password, no key.
- **Local storage** holds your interface language.

That is the whole list. The encryption code never touches browser storage at all.

## Security boundary

**What this promises**

- The complete ledger is only ever written to the file you picked. There is no account,
  no server, no sync, and no telemetry of any kind.
- The only outbound request the app makes is to Binance's public market-data endpoint,
  only when you click validate or refresh, and it carries nothing but a public trading
  pair symbol.
- Untrusted input — forms, ledger files, backup JSON, even the browser's own stored
  record — is validated at runtime before anything acts on it.
- An import replaces the ledger with the candidate that passed validation. It never
  merges, never imports part of a file, and never silently drops a record it disliked.
- A file the app refuses is refused before your password is used: nothing is decrypted,
  nothing is written back, and your original file is left exactly as it was.
- The four version numbers live in the file's plaintext outer layer, so the app can tell
  you precisely what it is refusing without needing the password.
- When the browser cannot prove what is actually on disk, the app stops and says so
  rather than guessing which version should win.

**What this does not promise**

- **Backup files are plaintext, and are outside the encryption guarantee entirely.**
  Anyone who can open the file can read your whole trading history. Nothing in this app
  protects an exported backup — where you put it is the only protection it has, and a
  sync folder may upload it without asking you.
- **Nothing here defends a machine that is already compromised.** While the ledger is
  unlocked, it is plaintext in the browser's memory, and anyone with your password and
  your file has your ledger.
- **There is no password recovery.** No reset, no escrow, no recovery code, no back
  door. A forgotten password means the ledger file is unreadable, including to you.
- **The write-and-verify sequence is not an operating-system-level atomic transaction.**
  It is the strongest thing a browser can do, which is not the same as a guarantee. Keep
  a separate backup of anything you cannot afford to lose.
- **Coordination between tabs relies on Web Locks and the file's identity.** It cannot
  constrain a program outside the browser that edits the same file without taking part.
- **None of this has been reviewed by an outside security auditor.** The cryptography is
  the browser's own Web Crypto API used in a straightforward way; that is a reasonable
  starting point, not a reviewed design.
- **This is Alpha,** so any of the above can still change.
