# Local-First Personal Trading Ledger

一个使用 Next.js 和 TypeScript 构建的本地优先个人交易账本原型。

项目当前重点不是完成 UI，而是先建立一套可验证的账本核心：交易作为原始事实保存，持仓、成本和盈亏由纯计算函数推导；非法交易必须在进入计算器和保存流程之前被拒绝。

> 当前进度：Week 5 Day 5 安全交易插入与 `tradeService` 已实现并完成工程验证（2026-07-14）。
>
> 已完成里程碑：Week 2 核心计算/校验；Week 4 Gate 1 的内存账本状态地基；Week 5 Day 2 `positionService`；Week 5 Day 3 Dashboard 真实持仓；Week 5 Day 4 BTC、ETH、ADA 生产资产来源；Week 5 Day 5 `createValidatedTrade(...)`。
>
> 下一开发任务：将 `createValidatedTrade(...)` 接入表单成功后的 dispatch，并让交易列表读取真实 `LedgerData.trades`。内存态 Gate 2-5 全绿前不进入 IndexedDB。

## 项目目标

长期目标是实现一个完全运行在浏览器中的个人交易账本：

- 数据保存在本地，不依赖远端服务。
- 金额和数量使用高精度十进制计算。
- 交易记录是唯一事实来源，持仓结果可以重新计算。
- 后续通过 IndexedDB 保存数据，并使用 Web Crypto API 加密。
- 支持 JSON 导入导出、资产汇总、图表和性能 benchmark。

当前仍是学习和论文验证原型，不是正式金融产品。

## Week 1–2、Week 4 Gate 1 与 Week 5 Day 2–5 已完成

### Week 1：确定边界和架构

- 明确第一版只处理买入、卖出和基础持仓盈亏。
- 设计 `Trade`、`Asset`、`PriceSnapshot`、`FeeRule`、`Position` 和 `LedgerData`。
- 确定 `Trade` 保存、`Position` 不保存的事实与派生数据边界。
- 完成页面空壳和写入、读取、保存、加密的数据流设计。
- 锁定后续保存链路：

```text
UI
→ Service
→ Repository
→ StorageAdapter
→ EncryptionService
→ IndexedDB
```

### Week 2：让账本算得对

- 使用 `DecimalString → decimal.js → 展示格式化` 处理数值精度。
- 实现 `decimalMath`，统一封装加、减、乘、除、比较和容差判断。
- 实现 `positionCalculator`：
  - 按交易时间排序。
  - 按资产聚合仓位。
  - 计算持仓数量、剩余成本和加权平均成本。
  - 卖出时按卖出前平均成本结转成本。
  - 计算 `realizedPnl`。
  - 按资产、币种和 `recordedAt` 选择最新 `PriceSnapshot`。
  - 计算 `latestPrice`、`marketValue` 和 `unrealizedPnl`。
  - 同时间快照以数组中后出现者为准；无匹配快照时不制造零值。
  - 保留超卖和零仓位卖出的防御性检查。
- 实现 `tradeValidator`：
  - 非法交易类型。
  - 资产不存在。
  - 数量、价格或总金额不是合法正数。
  - 手续费非法或小于零。
  - `quantity × price` 与 `totalValue` 明显冲突。
  - 候选交易插入完整时间线后任一时点出现负持仓。
  - 候选币种与 Asset 报价币种或同资产已有交易不一致。
- 将测试统一迁移到 Vitest。

### Week 4：页面状态地基

这一步还不是持久化，也不是加密。它只解决一个问题：

```text
页面不能再靠硬编码数组展示账本。
```

Gate 1 已经实现：

- `createInitialLedgerData()` 每次创建独立的 `LedgerData` 和独立生产资产对象。
- `initialLedgerData` 默认包含 BTC、ETH、ADA，用户交易、价格和手续费规则为空。
- `ledgerReducer` 支持 `trade/add`、`trade/delete`、`ledger/reset`。
- reducer 保持不可变更新，不承担交易校验、持仓计算或存储读写。
- `ledgerReducer.test.ts` 覆盖初始状态、引用独立性、新增、删除、缺失 ID 删除和重置。

Gate 2 已完成：`positionService` 与 Dashboard 真实资产汇总已接通。Gate 3–5 仍未完成：

```text
initialLedgerData
→ useReducer(ledgerReducer)
→ LedgerData
→ positionService
→ calculatePositions(...)
→ Position[]
→ DashboardShell 展示
```

新增交易计划走：

```text
表单输入
→ TradeDraft
→ tradeService
→ validateTradeDraft
→ Trade
→ dispatch({ type: "trade/add" })
→ ledgerReducer 写入 LedgerData.trades
```

Week 4 的边界：

- `ledgerReducer` 只管理账本状态，不做表单校验、不计算持仓、不读写 IndexedDB。
- 已实现的 `tradeService` 只负责校验草稿、生成唯一 ID 和时间，并返回正式 `Trade`；它不 dispatch、不修改 `LedgerData`。
- 已实现的 `positionService` 只负责“根据当前账本算持仓”，不碰表单、不保存数据、不自己写计算逻辑。
- `Position[]` 是派生结果，不进 `LedgerData` 保存。
- 不使用 `localStorage` 作为临时路线。

### Week 5 Day 4：生产内置资产来源

- `src/data/builtInAssets.ts` 提供固定的 BTC、ETH、ADA 生产资产定义。
- `createBuiltInAssets()` 每次返回新的数组和新的 Asset 对象，避免账本之间共享可变引用。
- `createInitialLedgerData()` 使用生产资产目录，不从 `src/test/fixtures.ts` 导入。
- `ledger/reset` 恢复内置资产，同时清空交易、价格快照和手续费规则。
- Validator golden 样例已改用生产初始化资产；BTC、ETH、ADA 可通过资产存在校验，未知资产仍被拒绝。
- 内置资产只用于新建账本和 reset；未来 hydrate/import 以保存或导入的完整 `LedgerData.assets` 为准，不自动混入内置资产。

### Week 5 Day 5：安全交易创建

- `tradeValidator` 现在会把候选交易按 `occurredAt` 插入完整时间线，同时间下保持已有数组顺序并将候选项放在最后。
- 任一卖出使该资产的时间线出现负持仓时，返回 `INSUFFICIENT_HOLDINGS`。
- 候选币种必须与 Asset `quoteCurrency` 及同资产已有交易一致；否则返回 `CURRENCY_MISMATCH`。
- `createValidatedTrade(...)` 复用 Validator，成功时返回新 `Trade`，校验失败与 Service 依赖失败使用不同结果分支。
- ID 生成和时钟可注入；ID 与已有 Trade 冲突时最多尝试 3 次，只在获得唯一 ID 后读取一次时间。
- Service 不 dispatch、不调用 Calculator，也不修改输入或 `LedgerData`。

## 当前数据流

当前已经实现五段可以独立验证的能力。

校验能力：

```text
不可信输入
→ TradeDraft
→ tradeValidator
→ ValidatedTradeDraft
```

计算能力：

```text
已有 Trade[] + PriceSnapshot[]
→ positionCalculator
→ Position[]
```

持仓派生 service：

```text
LedgerData.trades + LedgerData.priceSnapshots
→ getPositionsFromLedger(...)
→ calculatePositions(...)
→ Position[]
```

页面持仓接线：

```text
DashboardShell
→ useReducer(ledgerReducer, initialLedgerData)
→ LedgerData
→ getPositionsFromLedger(...)
→ Position[]
→ 资产汇总或空持仓状态
```

安全交易创建：

```text
不可信输入 + 当前 LedgerData
→ createValidatedTrade(...)
→ validateTradeDraft(...)
→ 正式 Trade / validation failure / service failure
```

`tradeService` 已实现，UI dispatch 与真实交易列表尚未接线。目标端到端数据流是：

```text
ValidatedTradeDraft
→ tradeService 生成正式 Trade
→ dispatch({ type: "trade/add" })
→ LedgerData.trades
→ positionService
→ positionCalculator
→ Position[]
```

已实现页面持仓数据流：

```text
DashboardShell
→ useReducer(ledgerReducer, initialLedgerData)
→ LedgerData
→ positionService
→ calculatePositions(...)
→ Position[]
```

模块职责：

- `validators`：判断输入是否合法，不保存数据，不生成持仓。
- `calculators`：计算持仓和盈亏，不读取或写入存储。
- `decimalMath`：项目内 Decimal 运算的统一入口。
- `state`：Week 4 新增，管理内存版 `LedgerData` 和账本动作。
- `services`：组织业务动作；`positionService` 与 `tradeService` 已实现。
- `repositories` / `adapters`：当前只有边界 README，占位不等于保存层已实现。

## Golden test 基准

Week 2 使用 5 条固定交易作为标准答案：

```text
BTC buy
ETH buy
ADA buy
ADA buy
ADA sell
```

计算结果：

| 资产 | 剩余数量 | 剩余成本 | 平均成本 | 已实现盈亏 |
| --- | ---: | ---: | ---: | ---: |
| BTC | `0.00016388` | `11` | `67122.28459848669` | `0` |
| ETH | `0.004854` | `10` | `2060.1565718994643` | `0` |
| ADA | `85.3244` | `21.297822152886115445` | `0.24960998439937597504` | `-0.702177847113884555` |

这组数据同时验证 ADA 多次买入、部分卖出、成本结转和已实现盈亏。

## 自动化验证

当前测试包括：

- DecimalMath 精度与容差。
- 5 条交易 golden test。
- BTC、ETH、ADA 持仓与平均成本。
- ADA 多次买入和部分卖出。
- `realizedPnl`。
- 最新价格选择、市值和未实现盈亏。
- 无价格快照、同时间快照和币种不匹配边界。
- Validator 全部基础规则。
- 成交金额容差边界。
- 无持仓卖出、超卖、等量清仓和剩余持仓判断。
- 未来买入不能支撑更早卖出，回填卖出不能破坏后续已有卖出。
- 同时间稳定顺序、跨资产隔离与 Validator 不可变性。
- 候选币种与 Asset 报价币种、同资产已有交易的币种一致性。
- 非法交易不会进入 Calculator。
- `tradeService` 正式 Trade 构造、错误分层、ID 冲突有限重试和依赖失败。
- Service 成功/失败路径的深度冻结不可变性，以及追加后可被 `positionService` 安全计算的跨层契约。
- 初始账本每次返回独立数组引用。
- reducer 新增、删除、缺失 ID 删除和重置行为。
- reducer 不负责交易业务校验。
- `positionService` 的空账本、无价格快照和有价格快照接线。
- Dashboard 持仓渲染、无价格占位和六列空持仓状态。

当前结果：

```text
Test Files  8 passed (8)
Tests       85 passed (85)
```

以上结果于 2026-07-14 重新运行 `npm test -- --run` 获得；同日 `tradeService`、Validator、`positionService` 和 Calculator 定向测试、lint、生产 build、边界扫描与 diff-check 全部通过。

运行全部测试：

```bash
npm test
```

监听测试文件：

```bash
npm run test:watch
```

## 本地运行

环境建议：

- Node.js 20、22 或 24+
- npm

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

浏览器访问：

```text
http://localhost:3000
```

完整检查：

```bash
npm test
npm run lint
npm run build
```

## 目录结构

```text
src/
  app/              Next.js 页面入口
  components/       UI 组件；Dashboard 资产汇总已读取真实内存账本
  models/           核心账本类型
  utils/            DecimalMath
  calculators/      持仓和盈亏纯计算
  validators/       TradeDraft 字段、完整持仓时间线与币种校验
  data/             生产内置资产目录与测试
  state/            已实现：initialLedgerData、ledgerReducer 与测试
  test/             共享 golden fixtures
  services/         已实现 positionService 与 tradeService
  repositories/     当前只有职责说明；账本读写接口尚未实现
  adapters/         当前只有职责说明；IndexedDB adapter 尚未实现
```

关键文件：

```text
src/models/types.ts
src/utils/decimalMath.ts
src/calculators/positionCalculator.ts
src/validators/tradeValidator.ts
src/data/builtInAssets.ts             # 已实现
src/data/builtInAssets.test.ts        # 已实现
src/state/initialLedgerData.ts        # 已实现
src/state/ledgerReducer.ts            # 已实现
src/state/ledgerReducer.test.ts       # 已实现
src/services/positionService.ts       # 已实现
src/services/positionService.test.ts  # 已实现
src/services/tradeService.ts          # 已实现
src/services/tradeService.test.ts     # 已实现
src/components/dashboard/DashboardShell.tsx       # 已接入真实持仓
src/components/dashboard/DashboardShell.test.ts   # 已实现
src/test/fixtures.ts
vitest.config.ts
```

## 当前尚未实现

- Dashboard 资产汇总已接入真实 `LedgerData`，但交易列表仍使用硬编码 `trades`。
- `tradeService` 尚未接入 UI 表单、dispatch 和 reducer。
- 真实交易列表、交易录入/删除和价格输入尚未接通。
- repository / storage adapter 仍为 README 占位。
- IndexedDB 持久化。
- AES-256-GCM 本地加密。
- 全量版本化 JSON 导入导出与失败回滚。
- 两张保留图表和性能 benchmark。
- 实时行情 API、NLP 输入和 Agent。

页面资产汇总已来自真实内存账本；交易列表仍是 UI 占位，不能视为真实账本交易。

## 下一步

按 2026-07-10 重排后的 Gate 顺序继续：

1. 将 `createValidatedTrade(...)` 接入表单，成功后再 dispatch，失败时区分字段校验与全局 Service 错误。
2. 让交易列表读取 `LedgerData.trades`，关闭 Week 5 Gate。
3. 在 Week 6 完成交易录入/删除、价格输入和内存态手动验收。
4. 只有内存态页面全绿后，Week 7 才进入 IndexedDB。

## 2026-07-10 后续路线

| 周 | 唯一阶段目标 |
| --- | --- |
| Week 5 | 补完服务层、reducer 接线和真实交易列表 |
| Week 6 | 完成交易/价格交互并关闭内存态 Gate |
| Week 7 | typed repository / storage adapter 与 IndexedDB |
| Week 8 | 全量版本化导出、原子导入与失败回滚 |
| Week 9 | PBKDF2 + AES-256-GCM 与 hard-offline |
| Week 10 | 两张保留图表 |
| Week 11 | benchmark 协议、生成器、harness 与 pilot |
| Week 12 | 论文证据、P0 全量回归与发布门 |
| Week 13 | final benchmark、可复现验收与暑期冻结 |

NLP、Agent、第三张图和 100k benchmark 不属于暑期硬通过线。
