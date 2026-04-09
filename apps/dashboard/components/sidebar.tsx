"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { href: "/", label: "Overview", icon: "O", description: "Ecosystem health" },
  { href: "/products", label: "Products", icon: "P", description: "Managed products" },
  { href: "/lifecycle", label: "Lifecycle", icon: "L", description: "Active runs" },
  { href: "/insights", label: "Insights", icon: "I", description: "Self-evolution" },
  { href: "/team", label: "Team", icon: "T", description: "Settings & access" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-[var(--archibald-border)] bg-[var(--archibald-surface)]">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-[var(--archibald-border)] px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--archibald-primary)]">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="4" r="2" fill="white" />
            <circle cx="4" cy="13" r="2" fill="white" />
            <circle cx="14" cy="13" r="2" fill="white" />
            <line x1="9" y1="6" x2="4" y2="11" stroke="white" strokeWidth="1.5" />
            <line x1="9" y1="6" x2="14" y2="11" stroke="white" strokeWidth="1.5" />
            <line x1="4" y1="13" x2="14" y2="13" stroke="white" strokeWidth="1.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold tracking-wide text-[var(--archibald-text)]">ARCHIBALD</p>
          <p className="text-[10px] text-[var(--archibald-text-muted)]">Lifecycle Orchestrator</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--archibald-primary)] text-white"
                  : "text-[var(--archibald-text-muted)] hover:bg-[var(--archibald-border)] hover:text-[var(--archibald-text)]",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded text-xs font-bold",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-[var(--archibald-border)] text-[var(--archibald-text-muted)]",
                )}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer: product switcher hint */}
      <div className="border-t border-[var(--archibald-border)] p-4">
        <div className="rounded-lg bg-[var(--archibald-bg)] px-3 py-2 text-xs text-[var(--archibald-text-muted)]">
          <p className="font-medium text-[var(--archibald-text)]">Archibald Ecosystem</p>
          <p className="mt-0.5">5 solutions managed</p>
        </div>
      </div>
    </aside>
  );
}
