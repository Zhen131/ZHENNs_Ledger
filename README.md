# Local-First Personal Trading Ledger

一个使用 Next.js、React 和 TypeScript 构建的浏览器本地优先交易账本原型。

## 当前状态

截至 2026-07-22，Week 7 安全 clear、统一持久化操作互斥、B 批次可靠性补漏与 S-07 ResourcePolicy 已完成。
固定 BTC / ETH 数据的 production build 新增、价格、删除、刷新和 clear 主链通过；
production DevTools 已直接读取 `ledger:v1` envelope，并确认 clear 后 record 不存在。
Week 7 Storage Gate 判定为 **Go**，Week 8 可在用户确认后开始。

功能分支已实现：

- 交易表单：校验成功后写入 `LedgerData.trades`，列表和持仓同步更新。
- 安全删除：删除后若会破坏后续卖出时间线，则拒绝删除。
- 价格表单：写入 `PriceSnapshot` 后更新最新价格、市值和未实现盈亏。
- 真实交互回归：覆盖合法新增、非法输入、超卖、安全删除、价格联动。
- 整账运行时校验：保存或恢复前检查 schema、实体、Decimal、日期、引用、唯一性和交易时间线。
- IndexedDB whole-blob 持久化：通过 Repository、Noop EncryptionService 和 StorageAdapter 保存整份账本。
- 安全 hydration：恢复数据真正进入 reducer 前保持 `loading`，禁止 dispatch 和自动保存。
- 串行自动保存：快速连续修改按顺序写入；失败时保留页面状态并显示错误。
- 保存状态语义：页面区分“已加入账本”“正在保存到本地”“已保存到本地”和保存失败。
- 失败安全重试：最新保存失败可重试，旧 snapshot、旧 Repository generation 和重复点击不能覆盖新账本。
- dirty 离开保护：pending / save error 会标记未落盘，离开页面或切换 Repository 前会警告或要求明确放弃。
- ResourcePolicy：v1 限制文件 8 MiB、assets 500、trades 25,000、priceSnapshots 5,000、feeRules 500 和关键字符串长度。
- 超限保护：既有结构合法但超限的账本只读恢复；新 mutation 在进入 reducer 前拒绝，禁止自动保存与 clear 覆盖旧数据。
- 自动化重挂载验收：使用真实组装链和 fake IndexedDB 证明交易、价格可在卸载后恢复。
- 安全 clear：正常状态和 hydration error 状态均使用固定文本二段确认，完整删除本地账本并恢复全新的内置资产初始账本。
- 通用持久化操作互斥：dispatch、自动保存和 clear 共用同步 operation ref 与写队列；重复 clear 共享同一 Promise。
- clear 生命周期保护：覆盖排队写入、前置保存失败、clear 失败、Repository 切换和组件卸载。
- clear 后空库保护：清空成功不自动保存初始账本；第一次新用户写入才重新生成 record。
- 八列资产汇总：直接展示 `Position.costBasis` 和 `Position.realizedPnl`，并明确当前手续费不计入口径。
- golden UI 回归：逐笔填写真实表单，覆盖 5 条 golden、BTC 价格、ADA 超卖和两类删除。
- 响应式收口：宽窄屏页面不再整体横向溢出，宽表只在自己的容器内滚动。

当前自动化结果：

```text
Storage Gate 基线：19 个测试文件、169 项测试
B 批次补漏后：19 个测试文件、188 项测试
S-07 ResourcePolicy 后：20 个测试文件、195 项测试
npm run lint  -> 无 warning / error
npm run build -> Compiled successfully
```

生产 UI 验收结果：

```text
5 条 golden -> BTC / ETH / ADA 数量、剩余成本、已实现盈亏通过
BTC 70000 USD -> 市值 11.4716 USD，未实现盈亏 0.4716 USD
ADA 超卖 -> 拒绝且账本仍为 5 条交易
不安全删除 -> 拒绝；安全删除 BTC -> 4 条交易且 BTC 持仓消失
390 / 1280 宽度 -> 页面级无横向溢出，控制台无 warning / error
```

Week 7 固定 production build 样例：

```text
BTC 0.001 @ 70000 USD -> 成本 70 USD，已实现盈亏 0 USD
BTC 80000 USD         -> 市值 80 USD，未实现盈亏 10 USD
ETH 0.005 @ 2000 USD  -> 保存刷新后总交易数 2
删除 ETH 并刷新        -> 总交易数 1，BTC 数值保持不变
clear 并刷新           -> 空交易、空持仓；首次新写入可再次刷新恢复
控制台                  -> 无 warning / error
```

production DevTools 补充验收：已直接读取 `ledger:v1`，确认 `formatVersion = 1`、
明文完整 `LedgerData` 且不包含 `Position[]`；clear 后已直接确认 record 不存在。

## 核心原则

- `Trade` 和 `PriceSnapshot` 是事实数据。
- `Position[]` 由交易和价格临时推导，不写入 reducer 或 IndexedDB。
- 数量和金额使用 `DecimalString -> decimal.js`，不使用 JavaScript 浮点数重算账本。
- 不可信表单、IndexedDB 和未来 JSON 输入必须先通过运行时校验。
- UI、Service 和 Reducer 不直接操作 IndexedDB。
- 当前 Noop EncryptionService 只保留接口，不提供保密性；IndexedDB 数据仍是可读明文。
- Week 7 只保证单标签页内的顺序与 clear 安全；另一标签页可能在 clear 后把旧状态重新写回。

## 已实现数据流

交易写入：

```text
TradeForm
-> createValidatedTrade(...)
-> validateTradeDraft(...)
-> dispatch(trade/add)
-> LedgerData.trades
-> positionService
-> positionCalculator
-> 列表与持仓
```

价格写入：

```text
PriceForm
-> createValidatedPriceSnapshot(...)
-> validatePriceSnapshotDraft(...)
-> dispatch(priceSnapshot/add)
-> LedgerData.priceSnapshots
-> positionCalculator
-> 最新价格 / 市值 / 未实现盈亏
```

持久化：

```text
DashboardShell
-> usePersistentLedger
-> LedgerRepository
-> NoopEncryptionService
-> IndexedDbStorageAdapter
-> IndexedDB whole-blob envelope
```

恢复：

```text
IndexedDB
-> Repository 解包与整账校验
-> ledger/replace
-> 确认 reducer 已显示恢复快照
-> hydration ready
-> 才允许用户写入和自动保存
```

## 目录职责

```text
src/
  app/           Next.js 页面入口
  components/    Dashboard、交易表单、价格表单和交易列表
  models/        Asset、Trade、PriceSnapshot、Position、LedgerData 等类型
  utils/         Decimal 运算统一入口
  calculators/   持仓、成本和盈亏纯计算
  validators/    交易、价格、ISO 日期和完整 LedgerData 运行时校验
  services/      交易创建、安全删除、价格创建和持仓派生
  state/         初始账本、reducer、replace 与 hydration 状态
  repositories/  整账 load / save / clear 与运行时校验边界
  encryption/    EncryptionService 与当前 Noop 实现
  adapters/      原生 IndexedDB whole-blob 适配器
  composition/   具体 Adapter、加密与 Repository 的唯一组装点
  test/          共享 golden fixtures
```

## 主要安全边界

- 交易日期和价格日期只接受严格的 `YYYY-MM-DD` 或带时区 ISO datetime。
- 候选卖出加入完整时间线后，任一时点都不能出现负持仓。
- 删除交易前重新验证候选账本；Reducer 仍只负责不可变状态更新。
- 保存前和恢复后都运行完整 `LedgerData` Validator。
- 空数据库返回 `null`，不会伪装成“已经保存的空账本”。
- hydration 失败后自动保存保持关闭，避免空状态覆盖旧记录。
- clear 只在 ready 或 hydration error 的受控恢复入口执行；loading 状态不可清空。
- dispatch、save 和 clear 共用同一 operation/queue 顺序边界，clear 期间全部写入口禁用。
- clear 成功后初始账本不会自动重建 `ledger:v1`，第一次新用户写入才会保存。
- IndexedDB 只出现在 Adapter；具体实例只在 composition 组装点创建。

## 本地运行

建议使用 Node.js 20、22 或 24+。

```bash
npm install
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
git diff --check
```

## 尚未关闭

- Week 7 Storage Gate 已 Go；Week 8 导入导出尚未开始。
- S-07 已完成；大账本性能预算、分页和 virtual list 仍待 Week 11 benchmark 定义，不能据此宣称 25,000 笔交易流畅。
- load / save / clear、排队写入、重复 clear、Repository 切换和卸载均已有确定性故障注入测试；production DevTools envelope 与 clear record 直读证据已补齐。
- 分页、virtual list 和大账本性能上限尚未定义。
- 交易列表仍按保存顺序展示；回填交易的显示排序规则尚未确定。
- Noop EncryptionService 不提供加密；真加密计划在后续 Web Crypto 阶段完成。
- JSON 导入导出、图表、benchmark 和论文发布门尚未实现。
- `npm audit` 当前报告 5 个依赖漏洞；Next.js 与 lint 工具链升级需要单独评估，未执行强制大版本修复。

## Git 状态

- 07A 风险补漏已合入并推送源码 `main`。
- 合并提交：`d936463 合并07A风险补漏与Week6-7提前实现`。
- 已合并的功能分支 `zhennn/close-week6-week7-07a-risks` 已删除。
- Week 7 源码已进入 `main` / `origin/main`，包含 `529983e` 合并提交及 S-01 / S-02 / S-03 三个补漏提交。
- S-07 提交 `c2b8c06`、`7b1597d`、`dc89f35` 与文档提交 `6ea5c75` 已进入 `main` / `origin/main`。
- Week 8 尚未开始；production DevTools G-01 / G-02 直接 record 证据已关闭。
