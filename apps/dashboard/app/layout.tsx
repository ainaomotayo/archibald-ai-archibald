import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARCHIBALD — Autonomous Lifecycle Orchestrator",
  description: "Manage the complete software lifecycle: conception to evolution",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen bg-[var(--archibald-bg)] text-[var(--archibald-text)] antialiased"
        style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}
