import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CCF 会议助手",
  description: "会议截稿、投稿要求与研究方向匹配查询。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
