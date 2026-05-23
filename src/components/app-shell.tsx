"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Brain,
  CheckSquare,
  Compass,
  CreditCard,
  LifeBuoy,
  MapPinned,
} from "lucide-react";
import type { ReactNode } from "react";
import { QaModeBanner } from "./qa-mode-banner";

const links = [
  { href: "/", label: "Today", icon: Compass },
  { href: "/next-move", label: "Find My Next Move", icon: LifeBuoy },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/memory", label: "Memory", icon: Brain },
];

const secondaryLinks = [
  { href: "/situations", label: "Situations", icon: MapPinned },
  { href: "/history", label: "History", icon: Archive },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#02040a]/95 backdrop-blur">
        <QaModeBanner />
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-[var(--azure)] bg-slate-950 shadow-[0_0_24px_rgba(0,120,212,0.25)]">
                <Image
                  src="/brand/flowpath-mark-square.png"
                  alt=""
                  width={40}
                  height={40}
                  priority
                  unoptimized
                  className="h-full w-full object-cover"
                />
              </span>
              <div>
                <div className="text-lg font-semibold tracking-normal">FlowPath</div>
                <div className="text-xs text-slate-400">
                  Find the next move that actually matters.
                </div>
              </div>
            </Link>
            {isSignedIn ? <UserButton /> : null}
          </div>
          <div className="flex flex-col gap-2">
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
            <nav className="flex flex-wrap gap-3 text-xs text-slate-500">
              {secondaryLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex items-center gap-1 hover:text-slate-300"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <div className="mx-auto max-w-6xl px-4 pb-6 text-xs text-slate-500 sm:px-6 lg:px-8">
        FlowPath is not a substitute for legal, medical, financial, or emergency help.
      </div>
    </div>
  );
}
