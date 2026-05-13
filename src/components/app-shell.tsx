"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Brain,
  CheckSquare,
  Compass,
  LifeBuoy,
  MapPinned,
} from "lucide-react";
import type { ReactNode } from "react";

const links = [
  { href: "/", label: "Today", icon: Compass },
  { href: "/next-move", label: "Find My Next Move", icon: LifeBuoy },
  { href: "/situations", label: "Situations", icon: MapPinned },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/memory", label: "Memory / Profile", icon: Brain },
  { href: "/history", label: "History", icon: Archive },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#02040a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--azure)] bg-[var(--azure)] text-sm font-semibold text-white shadow-[0_0_24px_rgba(0,120,212,0.25)]">
                N
              </span>
              <div>
                <div className="text-lg font-semibold tracking-normal">Needle</div>
                <div className="text-xs text-slate-400">
                  What moves the needle today?
                </div>
              </div>
            </Link>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active =
                link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                    active
                      ? "bg-[var(--azure)] text-white shadow-[0_0_24px_rgba(0,120,212,0.22)]"
                      : "border border-slate-800 bg-slate-950 text-slate-300 hover:border-[var(--azure)] hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <div className="mx-auto max-w-6xl px-4 pb-6 text-xs text-slate-500 sm:px-6 lg:px-8">
        Needle is not a substitute for legal, medical, financial, or emergency help.
      </div>
    </div>
  );
}
