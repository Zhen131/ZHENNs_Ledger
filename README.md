# Local-First Personal Trading Ledger

一个使用 Next.js 和 TypeScript 构建的本地优先个人交易账本原型。

项目当前重点不是完成 UI，而是先建立一套可验证的账本核心：交易作为原始事实保存，持仓、成本和盈亏由纯计算函数推导；非法交易必须在进入计算器和保存流程之前被拒绝。

> 当前进度：Week 2 / Day 6（2026-06-24）
>
> 当前里程碑：核心账本能够计算、校验并通过自动化测试证明结果正确。

## 项目目标

长期目标是实现一个完全运行在浏览器中的个人交易账本：

- 数据保存在本地，不依赖远端服务。
- 金额和数量使用高精度十进制计算。
- 交易记录是唯一事实来源，持仓结果可以重新计算。
- 后续通过 IndexedDB 保存数据，并使用 Web Crypto API 加密。
- 支持 JSON 导入导出、资产汇总、图表和性能 benchmark。

当前仍是学习和论文验证原型，不是正式金融产品。

## Week 1–2 已完成

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
  - 保留超卖和零仓位卖出的防御性检查。
- 实现 `tradeValidator`：
  - 非法交易类型。
  - 资产不存在。
  - 数量、价格或总金额不是合法正数。
  - 手续费非法或小于零。
  - `quantity × price` 与 `totalValue` 明显冲突。
  - 卖出超过当前持仓。
- 将测试统一迁移到 Vitest。

## 当前数据流

```text
不可信输入
→ TradeDraft
→ tradeValidator
→ ValidatedTradeDraft
→ Trade
→ positionCalculator
→ Position[]
```

模块职责：

- `validators`：判断输入是否合法，不保存数据，不生成持仓。
- `calculators`：计算持仓和盈亏，不读取或写入存储。
- `decimalMath`：项目内 Decimal 运算的统一入口。
- `services`：后续负责组织校验、生成交易和保存流程。

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
- Validator 全部基础规则。
- 成交金额容差边界。
- 无持仓卖出、超卖、等量清仓和剩余持仓判断。
- 非法交易不会进入 Calculator。

当前结果：

```text
Test Files  3 passed
Tests       36 passed
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
  test/             共享 golden fixtures
  services/         后续业务流程编排
  repositories/     后续账本读写接口
  adapters/         后续 IndexedDB 等外部适配
```

关键文件：

```text
src/models/types.ts
src/utils/decimalMath.ts
src/calculators/positionCalculator.ts
src/validators/tradeValidator.ts
src/test/fixtures.ts
vitest.config.ts
```

## 当前尚未实现

- 最新价格、当前市值和未实现盈亏。
- 页面真实交易状态和表单接入。
- IndexedDB 持久化。
- AES-256-GCM 本地加密。
- JSON 导入导出。
- 图表和性能 benchmark。
- 实时行情 API、NLP 输入和 Agent。

页面中现有资产和交易数据仍是 UI 占位，不能视为真实账本状态。

## 下一步

Week 2 剩余入口：

1. 根据最新 `PriceSnapshot` 计算 `latestPrice`。
2. 计算 `marketValue` 和 `unrealizedPnl`。
3. 为无快照、多快照和市值盈亏补充测试。

随后进入 Week 3：把 Validator 和 Calculator 接入页面内存状态，打通“新增交易 → 校验 → 更新列表 → 查看持仓”的完整流程。
