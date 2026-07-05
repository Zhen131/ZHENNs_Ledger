# Local-First Personal Trading Ledger

一个使用 Next.js 和 TypeScript 构建的本地优先个人交易账本原型。

项目当前重点不是完成 UI，而是先建立一套可验证的账本核心：交易作为原始事实保存，持仓、成本和盈亏由纯计算函数推导；非法交易必须在进入计算器和保存流程之前被拒绝。

> 当前进度：Week 4 React 内存账本状态地基准备中（2026-07-05）
>
> 已完成里程碑：Week 2 核心账本能够根据交易和价格快照计算持仓、成本与盈亏，并通过自动化测试证明结果正确。
>
> 当前开发目标：把页面从硬编码展示改成 `useReducer + LedgerData` 内存态账本。刷新丢失数据可以接受，IndexedDB 是 Week 5。

## 项目目标

长期目标是实现一个完全运行在浏览器中的个人交易账本：

- 数据保存在本地，不依赖远端服务。
- 金额和数量使用高精度十进制计算。
- 交易记录是唯一事实来源，持仓结果可以重新计算。
- 后续通过 IndexedDB 保存数据，并使用 Web Crypto API 加密。
- 支持 JSON 导入导出、资产汇总、图表和性能 benchmark。

当前仍是学习和论文验证原型，不是正式金融产品。

## Week 1–2 已完成，Week 4 正在接入

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

### Week 4：页面状态地基（当前目标）

这一步还不是持久化，也不是加密。它只解决一个问题：

```text
页面不能再靠硬编码数组展示账本。
```

计划接入的数据流：

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
- `tradeService` 只负责“新增交易”动作，校验失败只返回错误，不改数据。
- `positionService` 只负责“根据当前账本算持仓”，不碰表单、不保存数据、不自己写计算逻辑。
- `Position[]` 是派生结果，不进 `LedgerData` 保存。
- 不使用 `localStorage` 作为临时路线。

## 当前数据流

已完成的核心计算数据流：

```text
不可信输入
→ TradeDraft
→ tradeValidator
→ ValidatedTradeDraft
→ Trade
→ positionCalculator
→ Position[]
```

Week 4 目标页面数据流：

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
- `services`：组织业务动作；Week 4 先接 `tradeService` 和 `positionService`，Week 5 再接保存层。

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

当前结果：

```text
Test Files  3 passed
Tests       40 passed
```

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
  state/            Week 4 计划新增：initialLedgerData 与 ledgerReducer
  test/             共享 golden fixtures
  services/         业务流程编排：tradeService、positionService
  repositories/     后续账本读写接口
  adapters/         后续 IndexedDB 等外部适配
```

关键文件：

```text
src/models/types.ts
src/utils/decimalMath.ts
src/calculators/positionCalculator.ts
src/validators/tradeValidator.ts
src/state/initialLedgerData.ts        # Week 4 计划新增
src/state/ledgerReducer.ts            # Week 4 计划新增
src/services/positionService.ts       # Week 4 计划新增
src/services/tradeService.ts          # Week 4 计划接入新增交易
src/test/fixtures.ts
vitest.config.ts
```

## 当前尚未实现

- 页面真实交易状态和表单接入：`DashboardShell` 仍然使用硬编码资产和交易展示。
- `initialLedgerData`、`ledgerReducer`、`positionService` 尚未接入页面。
- `tradeService` 尚未完整负责新增交易动作。
- IndexedDB 持久化。
- AES-256-GCM 本地加密。
- JSON 导入导出。
- 图表和性能 benchmark。
- 实时行情 API、NLP 输入和 Agent。

页面中现有资产和交易数据仍是 UI 占位，不能视为真实账本状态。

## 下一步

执行 Week 4 的 `01B_W4-useReducer状态地基执行与验收标准.md`：

1. 新增 `initialLedgerData` 和 `ledgerReducer`。
2. 新增 `positionService`，页面资产汇总改为从 `calculatePositions(...)` 派生。
3. 页面交易列表改为读取 `LedgerData.trades`。
4. 接入 `tradeService`，打通“新增交易 → 校验 → dispatch → 更新列表 → 查看持仓”。
5. 通过手动验收后，再进入 Week 5 IndexedDB。
