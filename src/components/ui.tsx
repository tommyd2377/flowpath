"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {eyebrow ? (
        <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
        {title}
      </h1>
      {children ? <div className="max-w-3xl text-slate-300">{children}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-200">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "min-h-11 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[var(--azure)] focus:ring-2 focus:ring-[rgba(0,120,212,0.28)]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClass} min-h-28 resize-y leading-6 ${props.className ?? ""}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary: "bg-[var(--azure)] text-white hover:bg-[#106ebe] disabled:bg-slate-700 disabled:text-slate-400",
    secondary:
      "border border-slate-700 bg-slate-900 text-slate-200 hover:border-[var(--azure)] hover:bg-slate-800 disabled:text-slate-500",
    danger:
      "border border-red-900/70 bg-red-950/45 text-red-200 hover:bg-red-900/55 disabled:text-red-800",
    ghost: "text-slate-300 hover:bg-slate-900 hover:text-white disabled:text-slate-600",
  };

  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success" | "warning";
}) {
  const tones = {
    info: "border-slate-800 bg-slate-950 text-slate-300",
    error: "border-red-900/70 bg-red-950/45 text-red-100",
    success: "border-[rgba(0,120,212,0.55)] bg-[rgba(0,120,212,0.14)] text-blue-100",
    warning: "border-amber-900/70 bg-amber-950/45 text-amber-100",
  };

  return <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-400">
      {children}
    </div>
  );
}
