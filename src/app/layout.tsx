import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zhenn's Ledger",
  description: "只由你选择的加密文件承载的本地优先交易账本。",
};

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
