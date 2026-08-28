import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "牽手過路走｜台灣生活資訊助手",
  description: "為視障者與高齡者整理交通、到站與天氣資訊。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要內容
        </a>
        {children}
      </body>
    </html>
  );
}
