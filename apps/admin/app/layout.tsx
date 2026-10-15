import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "玩伴島 · 系統管理",
  description: "Party Island administration",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
