# Local-First Trading Ledger

这是一个本地优先的个人交易账本原型，用来验证交易记录、持仓计算、平均成本和盈亏计算的核心流程。

当前项目还不是完整金融软件，也不是正式可用的记账产品。它的阶段目标是先把账本核心算对，再逐步接入页面、IndexedDB、导入导出和加密链路。

## 当前状态

截至 Week 2 / Day 5，已完成：

- Next.js 14 + TypeScript + Tailwind CSS 项目骨架。
- `src/models` 账本核心类型：`Trade`、`Asset`、`PriceSnapshot`、`FeeRule`、`Position`、`LedgerData` 等。
- `src/utils/decimalMath.ts` 十进制计算入口，统一处理加减乘除、比较和格式化。
- `src/calculators/positionCalculator.ts` 第一版持仓计算器。
- `positionCalculator` 已支持买入、卖出、平均成本、成本结转和已实现盈亏。
- `src/validators/tradeValidator.ts` 已拦截基础字段错误、成交金额冲突和超卖。
- Vitest 已统一覆盖 DecimalMath、仓位计算、golden 样例和 Validator 规则。

当前还没有实现：

- 没有把计算器接入页面。
- 没有 IndexedDB 保存层。
- 没有加密。
- 没有实时价格 API。
- 没有 NLP 输入或 Agent 问答。
- 没有未实现盈亏和最新价格快照计算。

## 如何启动

第一次拿到项目后，如果没有 `node_modules`，先安装依赖：

```bash
npm install
```

启动本地开发服务器：

```bash
npm run dev
```

然后在浏览器打开：

```text
http://localhost:3000
```

如果 3000 端口被占用，终端会提示新的端口，例如 `http://localhost:3001`。

## 常用检查命令

检查代码规范：

```bash
npm run lint
```

检查项目是否能正式构建：

```bash
npm run build
```

一次运行全部核心测试：

```bash
npm test
```

持续监听测试文件：

```bash
npm run test:watch
```

## 当前目录结构

目前重点看这些目录：

```text
src/
  app/              Next.js 页面入口、布局和全局样式
  components/       页面用到的 UI 组件
  models/           账本核心类型
  utils/            DecimalMath 等通用工具
  calculators/      持仓、均价、盈亏等纯计算逻辑
  validators/       交易草稿合法性校验
  test/             共享 golden fixtures
```

当前最重要的文件：

```text
src/models/types.ts
src/utils/decimalMath.ts
src/calculators/positionCalculator.ts
src/calculators/positionCalculator.test.ts
src/validators/tradeValidator.ts
src/validators/tradeValidator.test.ts
src/app/page.tsx
src/components/dashboard/DashboardShell.tsx
```

## 设计原则

当前核心规则：

- `Trade` 是原始交易事实，要保存。
- `Position` 是计算结果，不保存，需要时由 `Trade[]` 推导。
- 小数保存使用 `DecimalString`。
- 小数计算必须走 `decimalMath`，不要在业务代码里裸写 `quantity * price`。
- `positionCalculator` 是 pure calculator，不读写 storage，不调用 repository，不处理 UI。

```text
Trade[] -> positionCalculator -> Position[]
```

## 下一步

短期下一步：

- 合并 `positionCalculator v1` PR。
- 继续学习 `positionCalculator.ts` 和 `positionCalculator.test.ts`。
- 补 `tradeValidator`，包括数量、价格、手续费和超卖校验。
- 后续再接页面展示和 IndexedDB 保存层。

保存层、导入导出和加密链路仍然按后续 Week 计划推进，不混进当前 calculator v1。
