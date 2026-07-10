# Local-First Personal Trading Ledger

一个使用 Next.js 和 TypeScript 构建的本地优先个人交易账本原型。

项目当前重点不是完成 UI，而是先建立一套可验证的账本核心：交易作为原始事实保存，持仓、成本和盈亏由纯计算函数推导；非法交易必须在进入计算器和保存流程之前被拒绝。

> 当前进度：Week 4 Gate 1 已合并；Week 5 Day 1 已完成事实盘点与路线重排（2026-07-10）。
>
> 已完成里程碑：Week 2 核心计算/校验；Week 4 Gate 1 的 `initialLedgerData`、`ledgerReducer` 与 reducer 测试。
>
> 下一开发任务：实现 `positionService`，再把 `DashboardShell` 接到 `useReducer + LedgerData`。内存态页面验收通过前不进入 IndexedDB。

## 项目目标

长期目标是实现一个完全运行在浏览器中的个人交易账本：

- 数据保存在本地，不依赖远端服务。
- 金额和数量使用高精度十进制计算。
- 交易记录是唯一事实来源，持仓结果可以重新计算。
- 后续通过 IndexedDB 保存数据，并使用 Web Crypto API 加密。
- 支持 JSON 导入导出、资产汇总、图表和性能 benchmark。

当前仍是学习和论文验证原型，不是正式金融产品。

## Week 1–2 已完成，Week 4 Gate 1 已完成

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
  - 卖出超过当前持仓。
- 将测试统一迁移到 Vitest。

### Week 4：页面状态地基

这一步还不是持久化，也不是加密。它只解决一个问题：

```text
页面不能再靠硬编码数组展示账本。
```

Gate 1 已经实现：

- `createInitialLedgerData()` 每次创建独立的空 `LedgerData`。
- `initialLedgerData` 提供默认空内存账本。
- `ledgerReducer` 支持 `trade/add`、`trade/delete`、`ledger/reset`。
- reducer 保持不可变更新，不承担交易校验、持仓计算或存储读写。
- `ledgerReducer.test.ts` 覆盖初始状态、引用独立性、新增、删除、缺失 ID 删除和重置。

Gate 2–5 尚未完成，剩余接入数据流：

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
- 计划中的 `tradeService` 只负责“新增交易”动作，校验失败只返回错误，不改数据。
- 计划中的 `positionService` 只负责“根据当前账本算持仓”，不碰表单、不保存数据、不自己写计算逻辑。
- `Position[]` 是派生结果，不进 `LedgerData` 保存。
- 不使用 `localStorage` 作为临时路线。

## 当前数据流

当前已经实现的是两段彼此独立的核心能力。

校验能力：

```text
不可信输入
→ TradeDraft
→ tradeValidator
→ ValidatedTradeDraft
```

计算能力：

```text
已有 Trade[] + Asset[] + PriceSnapshot[]
→ positionCalculator
→ Position[]
```

两段之间的生产 glue 尚未实现。目标端到端数据流是：

```text
ValidatedTradeDraft
→ tradeService 生成正式 Trade
→ dispatch({ type: "trade/add" })
→ LedgerData.trades
→ positionService
→ positionCalculator
→ Position[]
```

目标页面数据流：

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
- `services`：组织业务动作；当前尚未实现 `tradeService` 和 `positionService`。
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
- 非法交易不会进入 Calculator。
- 初始账本每次返回独立数组引用。
- reducer 新增、删除、缺失 ID 删除和重置行为。
- reducer 不负责交易业务校验。

当前结果：

```text
Test Files  4 passed (4)
Tests       48 passed (48)
```

以上结果于 2026-07-10 重新运行 `npm test -- --run` 获得。

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
  components/       UI 组件和当前页面空壳
  models/           核心账本类型
  utils/            DecimalMath
  calculators/      持仓和盈亏纯计算
  validators/       TradeDraft 校验
  state/            已实现：initialLedgerData、ledgerReducer 与测试
  test/             共享 golden fixtures
  services/         当前只有职责说明；业务服务尚未实现
  repositories/     当前只有职责说明；账本读写接口尚未实现
  adapters/         当前只有职责说明；IndexedDB adapter 尚未实现
```

关键文件：

```text
src/models/types.ts
src/utils/decimalMath.ts
src/calculators/positionCalculator.ts
src/validators/tradeValidator.ts
src/state/initialLedgerData.ts        # 已实现
src/state/ledgerReducer.ts            # 已实现
src/state/ledgerReducer.test.ts       # 已实现
src/services/positionService.ts       # 计划中，尚不存在
src/services/tradeService.ts          # 计划中，尚不存在
src/test/fixtures.ts
vitest.config.ts
```

## 当前尚未实现

- 页面真实交易状态和表单接入：`DashboardShell` 仍然使用硬编码资产和交易展示。
- `DashboardShell` 尚未接入已经存在的 `initialLedgerData` 和 `ledgerReducer`。
- `positionService`、`tradeService` 尚未实现。
- 生产内存态账本尚未确定 BTC / ETH / ADA 等资产 seed 方案。
- 真实交易列表、交易录入/删除和价格输入尚未接通。
- repository / storage adapter 仍为 README 占位。
- IndexedDB 持久化。
- AES-256-GCM 本地加密。
- 全量版本化 JSON 导入导出与失败回滚。
- 两张保留图表和性能 benchmark。
- 实时行情 API、NLP 输入和 Agent。

页面中现有资产和交易数据仍是 UI 占位，不能视为真实账本状态。

## 下一步

按 2026-07-10 重排后的 Gate 顺序继续：

1. 实现 `positionService`，只复用 `calculatePositions(...)`，不重写计算逻辑。
2. 在 `DashboardShell` 接入 `useReducer(ledgerReducer, initialLedgerData)`，先让资产汇总来自真实内存态账本。
3. 明确生产资产 seed，避免把测试 fixture 直接当生产状态。
4. 实现 `tradeService`，复用 `validateTradeDraft(...)` 后再 dispatch。
5. 让交易列表读取 `LedgerData.trades`，关闭 Week 5 Gate。
6. 在 Week 6 完成交易录入/删除、价格输入和内存态手动验收。
7. 只有内存态页面全绿后，Week 7 才进入 IndexedDB。

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
