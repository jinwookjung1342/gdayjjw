import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JB우리캐피탈 월별 민원현황",
  description: "민원 데이터 분석 및 보고 자동화 시스템"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
