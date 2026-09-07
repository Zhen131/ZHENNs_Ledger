import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zhenn's Ledger",
  // The server renders this before any language preference is readable, so it
  // stays in one fixed language rather than following the interface (04A D-5d).
  description:
    "A local-first trading ledger carried only by the encrypted file you choose.",
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
