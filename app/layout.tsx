import type { Metadata } from "next";
import "./globals.css";
import DashboardLayout from "@/components/dashboard-layout";

export const metadata: Metadata = {
  title: "Agent 评测平台",
  description: "可接入多类型 Agent 的评测产品，先解决 Echo Agent 的评测难题",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <DashboardLayout>{children}</DashboardLayout>
      </body>
    </html>
  );
}
