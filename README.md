# Local-First Trading Ledger

这是 Week 1 / Day 4 的网页项目空壳产出。

当前项目不是完整金融软件，也不是正式账本功能版本。它的作用是先让项目能在浏览器里跑起来，让首页有基本结构，并让后续开发可以在 VS Code 里继续往下写。

## 当前状态

Day 4 已完成：

- 创建了 Next.js 14 + TypeScript + Tailwind CSS 项目。
- 搭好了 `Local-First Trading Ledger` 首页空壳。
- 首页已经包含四个核心区域：
  - 资产汇总
  - 新增交易
  - 交易列表
  - 价格输入
- 额外保留了一个资产走势占位区，未来可以放净值曲线或 K 线。
- 目前代码范围已经刻意保持很小，避免第一天打开 VS Code 就看到太多文件夹。

当前还没有实现：

- 没有真正保存交易。
- 没有计算持仓、平均成本和盈亏。
- 没有接入 localStorage 或 IndexedDB。
- 没有加密。
- 没有实时价格 API。
- 没有图表引擎。
- 没有 NLP 输入或 Agent 问答。

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

## 当前目录结构

目前只需要重点看这两个目录：

```text
src/
  app/              Next.js 页面入口、布局和全局样式
  components/       页面用到的 UI 组件
```

当前最重要的文件：

```text
src/app/page.tsx
src/components/dashboard/DashboardShell.tsx
src/app/layout.tsx
src/app/globals.css
```

其他根目录配置文件可以暂时不用深看。

## 设计原则

页面现在只负责展示空壳和收集输入。

未来正式写功能时，应该保持这个方向：

```text
页面
-> service
-> repository
-> storage adapter
```

也就是说：

- 页面负责输入和展示。
- 计算逻辑以后放到 service 或 calculator。
- 保存逻辑以后放到 repository。
- localStorage、IndexedDB、加密这些底层细节以后再接。

## 下一步

Day 5 再开始设计保存层和加密路线。

到时候再逐步加入：

- `LedgerRepository`
- `StorageAdapter`
- `EncryptionService`
- 页面到本地保存的数据流

这些目录和文件不要提前一次性全建出来，等真正开始 Day 5 时再加。
