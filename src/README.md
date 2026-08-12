# Source layout

The source tree has six responsibility areas. Keep new code in the area that owns its behavior, keep tests beside the code they verify, and use stable entry points across boundaries.

```text
src/
  app/           Next.js entries, access control, Dashboard, composition, and runtime persistence flow
  core/          Framework-free ledger facts, calculations, policies, state, shared primitives, and validation
  features/      Flat product capabilities with separate logic and UI entries
  platform/      Browser files, persistence, encryption, coordination, integrations, and retained legacy boundaries
  ui/            Shared UI primitives without feature ownership
  test-support/  Shared fixtures, test doubles, and permanent structure checks
```

## Placement rules

### `app`

`app` owns the Next.js entry files, the ledger access gate, Dashboard composition, file-access controllers, hydration state, and `usePersistentLedger`. It coordinates features and platform capabilities but does not duplicate their calculations, validation, or persistence contracts. `app/index.ts` exposes only stable application types needed by features.

### `core`

- `calculations` contains pure replay, quantity, fee-aware cost basis, realized P&L, market value, and unrealized P&L calculations. It does not read page state, persist data, or format user copy.
- `catalog` contains built-in asset facts used to create a new ledger.
- `models` defines `DecimalString`, assets, trades, prices, fee rules, positions, and `LedgerData`. Models define shape; they do not calculate, validate untrusted input, persist, or render.
- `policies` owns new-fact, import, date, currency, future-fact, and runtime mapping decisions.
- `shared` contains decimal arithmetic and ledger-date primitives. It is not a catch-all for code with a clearer owner.
- `state` contains initial ledger creation and reducer transitions. Derived positions remain outside stored state.
- `validation` owns runtime trust boundaries for trade drafts, price drafts, full ledgers, ISO dates, and resource limits. Normal validation failures return structured errors.

### `features`

The seven current features are `backup`, `charts`, `fees`, `market-data`, `portfolio`, `prices`, and `trades`. Each feature is flat:

- `index.ts` exports logic only.
- `ui.ts` exports UI only; it may be an empty module when a feature has no independent UI component.
- implementation files and their tests stay beside one another.

### `platform`

- `files` owns file handles, the minimal connection record, `.lftl V2` contracts and encryption, and `LedgerFileRepository`.
- `persistence` owns the shared ledger repository/session contracts and content identity. `ledgerContentIdentity.ts` retains the existing `createLedgerDataContentIdentity` export.
- `encryption` owns Base64URL encoding, explicit key derivation primitives, and passphrase policy.
- `coordination` owns the cooperative page lease and short write lock.
- `integrations` owns the Binance public REST boundary.
- `legacy` retains whole-ledger IndexedDB detection, the retired envelope/encryption implementation, and the read-only legacy access controller. These files remain required for rejection and negative-test coverage; they are not a migration path.

The active IndexedDB boundary stores only `connectionFormatVersion`, the browser file handle, and `expectedFileId`. Ledger data, revisions, fee rules, passwords, and cryptographic keys stay outside that connection record.

### `ui` and `test-support`

`ui` contains reusable visual primitives such as `ConfirmDeleteButton`. `test-support` contains deterministic fixtures and test-only doubles; production composition must never import the test-only `NoopEncryptionService`.

## Import contract

Use `./file` within one directory. Across boundaries, use only:

```text
@/core/<area>
@/platform/<area>
@/platform/persistence/identity
@/features/<feature>
@/features/<feature>/ui
@/app
@/ui
@/test-support
@root/package.json
```

Parent-relative imports, internal deep aliases, and other `@root` targets are rejected by ESLint and the source-layout test.

`@/platform/persistence/identity` is the only narrow platform sub-entry. It exposes only ledger-content identity functions so backup preflight can use them without loading the persistence repository barrel. Code already inside an area must use exact same-directory `./file` imports instead of re-entering its own stable entry.

## Adding a feature

Create one flat `src/features/<feature>/` directory. Add its logic and colocated tests, export logic from `index.ts`, export UI from `ui.ts`, and have other areas import only those two stable addresses. Do not create empty `components`, `services`, or `tests` subdirectories, and do not add an unimplemented feature shell.
