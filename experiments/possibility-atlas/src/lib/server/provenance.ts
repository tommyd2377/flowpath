import type { SourceSchema } from "../contracts";
import type { z } from "zod";

type Source = z.infer<typeof SourceSchema>;

type ConsultedSource = {
  canonicalUrl: string;
  url: string;
  title: string | null;
};

export type ExtractedEvidence = {
  sources: Map<string, ConsultedSource>;
  refusal: boolean;
  webSearchCalls: number;
  failedWebSearch: boolean;
};

type ModelSource = { title: string; url: string };

export type ValidatedSources = {
  sources: Source[];
  byCanonicalUrl: Map<string, Source>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function cleanTitle(value: string | null, fallback: string) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 240);
}

export function canonicalizeHttpsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

function addConsultedSource(
  sources: Map<string, ConsultedSource>,
  rawUrl: string,
  title: string | null,
) {
  const canonicalUrl = canonicalizeHttpsUrl(rawUrl);
  if (!canonicalUrl) return;
  const existing = sources.get(canonicalUrl);
  sources.set(canonicalUrl, {
    canonicalUrl,
    url: existing?.url ?? canonicalUrl,
    title: existing?.title ?? title,
  });
}

export function extractResponseEvidence(output: Array<unknown>): ExtractedEvidence {
  const sources = new Map<string, ConsultedSource>();
  let refusal = false;
  let webSearchCalls = 0;
  let failedWebSearch = false;

  for (const rawItem of output) {
    const item = record(rawItem);
    if (!item) continue;

    if (item.type === "web_search_call") {
      webSearchCalls += 1;
      if (item.status === "failed") failedWebSearch = true;
      const action = record(item.action);
      if (!action) continue;

      if (action.type === "search" && Array.isArray(action.sources)) {
        for (const rawSource of action.sources) {
          const source = record(rawSource);
          const url = source ? text(source.url) : null;
          if (url) addConsultedSource(sources, url, null);
        }
      } else if (action.type === "open_page") {
        const url = text(action.url);
        if (url) addConsultedSource(sources, url, null);
      } else if (action.type === "find_in_page") {
        const url = text(action.url);
        if (url) addConsultedSource(sources, url, null);
      }
      continue;
    }

    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const rawPart of item.content) {
      const part = record(rawPart);
      if (!part) continue;
      if (part.type === "refusal") {
        refusal = true;
        continue;
      }
      if (part.type !== "output_text" || !Array.isArray(part.annotations)) continue;
      for (const rawAnnotation of part.annotations) {
        const annotation = record(rawAnnotation);
        if (!annotation || annotation.type !== "url_citation") continue;
        const url = text(annotation.url);
        if (url) addConsultedSource(sources, url, text(annotation.title));
      }
    }
  }

  return { sources, refusal, webSearchCalls, failedWebSearch };
}

function sourceDomain(urlValue: string) {
  const hostname = new URL(urlValue).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

export function validateModelSources(
  modelSources: ModelSource[],
  evidence: ExtractedEvidence,
): ValidatedSources | null {
  const sources: Source[] = [];
  const byCanonicalUrl = new Map<string, Source>();

  for (const modelSource of modelSources) {
    const canonicalUrl = canonicalizeHttpsUrl(modelSource.url);
    if (!canonicalUrl || byCanonicalUrl.has(canonicalUrl)) return null;
    const consulted = evidence.sources.get(canonicalUrl);
    if (!consulted) return null;

    const source: Source = {
      id: `s${String(sources.length + 1).padStart(2, "0")}`,
      title: cleanTitle(consulted.title, modelSource.title),
      url: consulted.url,
      domain: sourceDomain(consulted.url),
    };
    sources.push(source);
    byCanonicalUrl.set(canonicalUrl, source);
  }

  return { sources, byCanonicalUrl };
}

export function resolveSourceIds(
  sourceUrls: string[],
  validated: ValidatedSources,
) {
  const ids: string[] = [];
  for (const rawUrl of sourceUrls) {
    const canonicalUrl = canonicalizeHttpsUrl(rawUrl);
    const source = canonicalUrl
      ? validated.byCanonicalUrl.get(canonicalUrl)
      : undefined;
    if (!source) return null;
    if (!ids.includes(source.id)) ids.push(source.id);
  }
  return ids.length > 0 ? ids : null;
}

export function sourceDomainsForIds(ids: string[], sources: Source[]) {
  const requested = new Set(ids);
  return new Set(
    sources.filter((source) => requested.has(source.id)).map((source) => source.domain),
  );
}

export function sourcesFromEvidence(evidence: ExtractedEvidence) {
  return [...evidence.sources.values()].slice(0, 16).map((source, index): Source => ({
    id: `s${String(index + 1).padStart(2, "0")}`,
    title: cleanTitle(source.title, sourceDomain(source.url)),
    url: source.url,
    domain: sourceDomain(source.url),
  }));
}

export function snapshotSourceLookup(sources: Source[]) {
  const lookup = new Map<string, Source>();
  for (const source of sources) {
    const canonical = canonicalizeHttpsUrl(source.url);
    if (canonical) lookup.set(canonical, source);
  }
  return lookup;
}

export function allUrlsBelongToSnapshot(
  sourceUrls: string[],
  sources: Source[],
) {
  const lookup = snapshotSourceLookup(sources);
  return (
    sourceUrls.length > 0 &&
    sourceUrls.every((rawUrl) => {
      const canonical = canonicalizeHttpsUrl(rawUrl);
      return canonical !== null && lookup.has(canonical);
    })
  );
}
