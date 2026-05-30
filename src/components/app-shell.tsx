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
  Globe2,
  Heart,
  LifeBuoy,
  LogIn,
  MapPinned,
  Send,
} from "lucide-react";
import type { ReactNode, SVGProps } from "react";
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

function TwitterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" {...props}>
      <path
        d="M13.9 10.4 21.2 2h-1.7l-6.3 7.2L8.1 2H2.3l7.7 11L2.3 22h1.7l6.8-7.8 5.4 7.8h5.8l-8.1-11.6Zm-2.4 2.8-.8-1.1-6.2-8.8h2.8l5 7.1.8 1.1 6.5 9.2h-2.8l-5.3-7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LinkedinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" {...props}>
      <path
        d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S.02 4.88.02 3.5 1.13 1 2.5 1s2.48 1.12 2.48 2.5ZM.4 8h4.2v13H.4V8Zm7.03 0h4.02v1.78h.06c.56-1.06 1.93-2.18 3.98-2.18 4.26 0 5.05 2.8 5.05 6.45V21h-4.2v-6.16c0-1.47-.03-3.36-2.05-3.36-2.05 0-2.36 1.6-2.36 3.25V21h-4.2V8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 .9C5.86.9.9 5.86.9 12c0 4.91 3.18 9.07 7.59 10.54.55.1.76-.24.76-.53v-2c-3.09.67-3.74-1.32-3.74-1.32-.51-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.6 1.21 3.24.93.1-.72.39-1.21.71-1.49-2.47-.28-5.07-1.23-5.07-5.49 0-1.21.43-2.2 1.15-2.98-.12-.28-.5-1.41.11-2.94 0 0 .94-.3 3.06 1.14.89-.25 1.84-.37 2.79-.38.95 0 1.9.13 2.79.38 2.12-1.44 3.05-1.14 3.05-1.14.61 1.53.23 2.66.11 2.94.72.78 1.15 1.77 1.15 2.98 0 4.27-2.6 5.21-5.08 5.49.4.34.76 1.02.76 2.06v3.06c0 .29.2.64.77.53A11.11 11.11 0 0 0 23.1 12C23.1 5.86 18.14.9 12 .9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PersonalFooter() {
  const footerLinks = [
    { href: "https://thomasdevito.me/", label: "Thomas DeVito website", icon: Globe2 },
    { href: "https://x.com/thomasfdevito", label: "Thomas DeVito on X", icon: TwitterIcon },
    { href: "https://t.me/doubting_tom", label: "Thomas DeVito on Telegram", icon: Send },
    { href: "https://www.linkedin.com/in/tdevito", label: "Thomas DeVito on LinkedIn", icon: LinkedinIcon },
    { href: "https://github.com/tommyd2377", label: "Thomas DeVito on GitHub", icon: GithubIcon },
  ];

  return (
    <footer className="personalFooter">
      <p>Presented by Thomas DeVito</p>
      <div className="personalFooterLinks">
        {footerLinks.map((link) => {
          const Icon = link.icon;
          return (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
            >
              <Icon aria-hidden="true" />
            </a>
          );
        })}
      </div>
      <div className="madeInNyc inline-flex items-center justify-center gap-1">
        Made with{" "}
        <Heart
          className="h-[1.15em] w-[1.15em] translate-y-[0.06em] text-[#e25555]"
          aria-hidden="true"
          fill="currentColor"
          strokeWidth={0}
        />{" "}
        in NYC
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();

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
            {isLoaded && isSignedIn ? (
              <UserButton />
            ) : isLoaded ? (
              <div className="flex items-center gap-2">
                <span className="hidden rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs font-medium text-slate-300 sm:inline-flex">
                  Guest mode
                </span>
                <Link
                  href="/sign-in"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 transition hover:border-[var(--azure)] hover:bg-slate-800"
                >
                  <LogIn className="h-4 w-4" />
                  Sign in
                </Link>
              </div>
            ) : (
              <div className="h-10 w-24" />
            )}
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
      <div className="mx-auto max-w-6xl px-4 text-xs text-slate-500 sm:px-6 lg:px-8">
        FlowPath is not a substitute for legal, medical, financial, or emergency help.
      </div>
      <PersonalFooter />
    </div>
  );
}
