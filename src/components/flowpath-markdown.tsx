"use client";

import { code } from "@streamdown/code";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import type { StreamdownProps } from "streamdown";

type FlowPathMarkdownProps = {
  content: string;
  isStreaming?: boolean;
  mode?: "streaming" | "static";
  variant?: "chat" | "plan" | "compact";
  className?: string;
};

const mermaid = createMermaidPlugin({
  config: {
    securityLevel: "strict",
    startOnLoad: false,
    theme: "dark",
  },
});

const plugins = { code, mermaid };

function isSafeHref(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const components: NonNullable<StreamdownProps["components"]> = {
  a: ({ href, children }) => {
    if (!isSafeHref(href)) {
      return <span className="text-slate-300">{children}</span>;
    }

    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img: ({ alt }) =>
    alt ? (
      <span className="text-xs text-slate-500">Image omitted: {alt}</span>
    ) : null,
};

const linkSafety: StreamdownProps["linkSafety"] = {
  enabled: true,
  onLinkCheck: (url) => isSafeHref(url),
};

const variantClasses: Record<NonNullable<FlowPathMarkdownProps["variant"]>, string> = {
  chat: "flowpathMarkdown flowpathMarkdownChat text-slate-100",
  plan: "flowpathMarkdown flowpathMarkdownPlan text-slate-300",
  compact: "flowpathMarkdown flowpathMarkdownCompact text-slate-300",
};

export function FlowPathMarkdown({
  content,
  isStreaming = false,
  mode,
  variant = "plan",
  className = "",
}: FlowPathMarkdownProps) {
  const renderMode = mode ?? (isStreaming ? "streaming" : "static");

  return (
    <Streamdown
      mode={renderMode}
      plugins={plugins}
      components={components}
      linkSafety={linkSafety}
      mermaid={{ config: { securityLevel: "strict", theme: "dark" } }}
      controls={{
        code: { copy: true, download: false },
        mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
        table: { copy: true, download: false, fullscreen: true },
      }}
      shikiTheme={["github-dark", "github-dark"]}
      lineNumbers={false}
      animated={
        isStreaming
          ? { animation: "blurIn", duration: 220, easing: "ease-out" }
          : undefined
      }
      isAnimating={isStreaming}
      caret={isStreaming ? "block" : undefined}
      className={`${variantClasses[variant]} ${className}`}
    >
      {content || ""}
    </Streamdown>
  );
}
