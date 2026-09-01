import type { Metadata } from "next";
import "./globals.css";
import { translateDefault } from "@/ui";

export const metadata: Metadata = {
  title: "Zhenn's Ledger",
  description: translateDefault("metadata.description"),
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
