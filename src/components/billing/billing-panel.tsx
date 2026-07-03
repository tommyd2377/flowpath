"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  CreditCard,
  ExternalLink,
  Sparkles,
  UserPlus,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { PAYWALL_DISABLED } from "@/lib/billing/plans";
import type { BillingSummary, UsageType } from "@/lib/types";
import { Button, Card, EmptyState, Notice, PageHeader } from "@/components/ui";

const usageLabels: Record<UsageType, string> = {
  today_checkin: "Today check-ins",
  next_move_plan: "Next Move plans",
  lightweight_assist: "Lightweight assists",
};

const planLabels: Record<BillingSummary["plan_tier"], string> = {
  free: "Free",
  core: "Core",
  internal_unlimited: "Internal unlimited",
  pro: "Pro",
  sponsored: "Sponsored",
};

function usageValue(used: number, limit: number | null) {
  return limit == null ? `${used} used` : `${used} / ${limit}`;
}

function remainingValue(remaining: number | null) {
  return remaining == null ? "Unlimited" : `${remaining} remaining`;
}

export function BillingPanel() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"checkout" | "portal" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiFetch<BillingSummary>("/api/billing/summary"));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load billing.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function startCheckout() {
    setWorking("checkout");
    setError(null);
    setMessage(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.assign(url);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not start checkout.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function openPortal() {
    setWorking("portal");
    setError(null);
    setMessage(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.assign(url);
    } catch (portalError) {
      setError(
        portalError instanceof Error
          ? portalError.message
          : "Could not open billing portal.",
      );
    } finally {
      setWorking(null);
    }
  }

  if (PAYWALL_DISABLED) {
    return (
      <div>
        <PageHeader eyebrow="Billing" title="Billing is disabled">
          <p>
            FlowPath is currently unlocked while the domain-general next-move
            engine is being rebuilt.
          </p>
        </PageHeader>
        <Card>
          <h2 className="text-xl font-semibold text-white">Core app access is free for now.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Usage limits, checkout, and upgrade prompts are dormant behind a
            disabled paywall flag. Stripe code remains in the codebase for a
            future pass, but no current app path needs payment to continue.
          </p>
        </Card>
      </div>
    );
  }

  const showCreateAccount = Boolean(summary?.is_guest);
  const showUpgrade = summary?.plan_tier === "free" && !summary.is_guest;
  const showManageBilling =
    !summary?.is_guest &&
    (summary?.plan_tier === "core" || Boolean(summary?.stripe_customer_id));

  return (
    <div>
      <PageHeader eyebrow="Billing" title="Plan and usage">
        <p>
          FlowPath includes a useful free monthly allowance, then asks heavy AI
          usage to move to Core so costs stay predictable.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {loading && !summary ? (
        <Card>
          <div className="text-sm text-slate-400">Loading billing...</div>
        </Card>
      ) : summary ? (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
                  Current plan
                </div>
                <h2 className="mt-1 text-3xl font-semibold">
                  {summary.is_guest ? "Guest" : planLabels[summary.plan_tier]}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {summary.is_guest
                    ? "Sign in to save this workspace and unlock the full free tier."
                    : `Billing status: ${summary.billing_status.replaceAll("_", " ")}`}
                </p>
              </div>
              {summary.internal_unlimited ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-[rgba(0,120,212,0.5)] bg-[rgba(0,120,212,0.16)] px-2 py-1 text-xs font-medium text-blue-100">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  internal test
                </span>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3">
              {showCreateAccount ? (
                <Link
                  href="/sign-up"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[var(--azure)] px-3 text-sm font-medium text-white transition hover:bg-[#106ebe]"
                >
                  <UserPlus className="h-4 w-4" />
                  Create free account
                </Link>
              ) : null}
              {showUpgrade ? (
                <Button
                  type="button"
                  onClick={startCheckout}
                  disabled={Boolean(working)}
                >
                  <Sparkles className="h-4 w-4" />
                  {working === "checkout" ? "Opening checkout..." : "Upgrade to Core"}
                  <ExternalLink className="h-4 w-4" />
                </Button>
              ) : null}
              {showManageBilling ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={openPortal}
                  disabled={Boolean(working)}
                >
                  <CreditCard className="h-4 w-4" />
                  {working === "portal" ? "Opening billing..." : "Manage billing"}
                  <ExternalLink className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            {summary.is_guest ? (
              <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300">
                Guest mode includes one full board intake and one Next Move
                plan. Create a free account to keep going after that.
              </div>
            ) : summary.plan_tier === "free" ? (
              <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300">
                Core is ${Math.round(summary.core_price_cents / 100)}/month for early
                traction: 20 Next Move plans, 31 Today check-ins, and 50 lightweight
                assists per month.
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">This month</h2>
              <p className="text-sm text-slate-400">
                {summary.usage_period_start} to {summary.usage_period_end}
              </p>
            </div>
            <div className="grid gap-3">
              {summary.usage.map((item) => (
                <div
                  key={item.usage_type}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-white">
                      {usageLabels[item.usage_type]}
                    </div>
                    <div className="text-sm text-slate-300">
                      {usageValue(item.used, item.limit)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-slate-400">
                    {remainingValue(item.remaining)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="mb-2 text-xl font-semibold">Safety boundary</h2>
            <p className="text-sm leading-6 text-slate-300">
              FlowPath helps you identify practical next moves. It is not emergency
              help, therapy, legal advice, medical care, financial advice, or a
              replacement for human support. For high-stakes boards, contact
              appropriate human or professional support.
            </p>
          </Card>
        </div>
      ) : (
        <EmptyState>Billing could not be loaded.</EmptyState>
      )}
    </div>
  );
}
