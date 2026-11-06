/**
 * 这个文件是 Next.js 规定的整站外壳。
 * 它管网页标题，网页描述，最外层的 html。
 * 页面内容在同目录 `page.tsx`，界面语言在 `ui/i18n.tsx`。
 * 不显然的决定：网页描述固定用英文，不跟界面语言走。
 * 2026-09-07 定（W16 04A 第二节 D-5d）。
 */
import type { Metadata } from "next";
import "./globals.css";

/** 网页的标题和描述，浏览器标签页和搜索结果里会显示。 */
export const metadata: Metadata = {
  title: "Zhenn's Ledger",
  // 为什么描述只用一种语言：服务器先生成它。那时读不到所选语言。
  // 2026-09-07 定（W16 04A 第二节 D-5d）。
  description:
    "A local-first trading ledger carried only by the encrypted file you choose.",
};

/**
 * 这个组件画整站最外层的 html 和 body，把页面内容放进去。
 * html 的语言标成简体中文。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
