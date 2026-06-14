# Local-First Trading Ledger

Day 4 output for the Week 1 project shell.

This is the runnable browser project for a local-first personal trading ledger.
The first milestone is not a full financial app yet. It is the empty shell that
lets the project open in VS Code, start in a browser, and keep the core
directories separated before real logic is added.

## Current Status

Completed in Day 4:

- Created a Next.js 14 + TypeScript + Tailwind CSS project.
- Built the home page shell for `Local-First Trading Ledger`.
- Added the four core homepage areas:
  - 资产汇总
  - 新增交易
  - 交易列表
  - 价格输入
- Added a future chart placeholder for asset net worth and K-line views.
- Added the initial project directories for models, services, repositories,
  adapters, providers, calculators, validators, components, and utils.
- Added first TypeScript model and interface placeholders.

Not implemented yet:

- No real trade saving.
- No position or P&L calculation.
- No IndexedDB/localStorage repository implementation.
- No encryption.
- No API price feed.
- No chart engine.
- No NLP or Agent workflow.

## Run Locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Useful checks:

```bash
npm run lint
npm run build
```

## Project Structure

```text
src/
  app/              Next.js App Router pages and layout
  components/       UI components
  models/           Core data shapes: Trade, Asset, PriceSnapshot, Position
  services/         Business workflow boundaries
  repositories/     Data access interfaces
  adapters/         Future localStorage, IndexedDB, import/export adapters
  providers/        Future price, market data, and AI providers
  calculators/      Future DCA, holdings, P&L, and report calculations
  validators/       Future trade and price validation rules
  utils/            Small shared constants and helpers
```

## Design Rule

The page should only display UI and collect input.

```text
UI page
-> service
-> repository
-> storage adapter
```

Calculations belong in calculators/services. Saving belongs in repositories and
adapters. Data shape belongs in models.

## Next Step

Day 5 should design the saving and encryption route:

- `LedgerRepository`
- `StorageAdapter`
- `EncryptionService`
- data flow from page to local storage

