import { createHash } from "node:crypto";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  HeadlineItemSchema,
  MAX_HEADLINES,
  type HeadlineItem,
} from "../contracts";

export const MAX_RSS_BYTES = 1024 * 1024;

const MAX_XML_DEPTH = 32;
const GOOGLE_NEWS_HOSTNAME = "news.google.com";
const GOOGLE_NEWS_ITEM_PATH_PREFIX = "/rss/articles/";
const FORBIDDEN_XML_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

type UnknownRecord = Record<string, unknown>;

export type ParsedGoogleNewsFeed = {
  items: HeadlineItem[];
  feedUpdatedAt: string | null;
};

export class GoogleNewsRssError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleNewsRssError";
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return record && typeof record["#text"] === "string"
    ? record["#text"]
    : null;
}

function normalizeText(value: unknown): string | null {
  const text = textValue(value)?.replace(/\s+/g, " ").trim();
  return text || null;
}

function toIsoDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseHttpsUrl(value: unknown): URL | null {
  const text = normalizeText(value);
  if (!text || text.length > 2048) return null;

  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function parseGoogleNewsItemUrl(value: unknown): string | null {
  const url = parseHttpsUrl(value);
  if (
    !url ||
    url.hostname !== GOOGLE_NEWS_HOSTNAME ||
    url.port ||
    !url.pathname.startsWith(GOOGLE_NEWS_ITEM_PATH_PREFIX)
  ) {
    return null;
  }
  return url.toString();
}

function parsePublisherUrl(value: unknown): string | null {
  const url = parseHttpsUrl(value);
  return url ? url.toString() : null;
}

export function stripExactPublisherSuffix(
  title: string,
  publisher: string | null,
): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  if (!title.endsWith(suffix) || title.length === suffix.length) return title;
  return title.slice(0, -suffix.length).trimEnd();
}

function deterministicHeadlineId(guid: string | null, googleNewsUrl: string) {
  return createHash("sha256")
    .update(guid || googleNewsUrl, "utf8")
    .digest("hex");
}

function normalizeItem(value: unknown): HeadlineItem | null {
  const item = asRecord(value);
  if (!item) return null;

  const source = asRecord(item.source);
  const publisherText = normalizeText(item.source);
  const publisher =
    publisherText && publisherText.length <= 100 ? publisherText : null;
  const googleNewsUrl = parseGoogleNewsItemUrl(item.link);
  const rawTitle = normalizeText(item.title);
  if (!googleNewsUrl || !rawTitle) return null;

  const title = stripExactPublisherSuffix(rawTitle, publisher);
  if (!title || title.length > 240) return null;

  const guidText = normalizeText(item.guid);
  const guid = guidText && guidText.length <= 512 ? guidText : null;
  const candidate = {
    id: deterministicHeadlineId(guid, googleNewsUrl),
    title,
    publisher,
    publisherUrl: parsePublisherUrl(source?.["@_url"]),
    googleNewsUrl,
    publishedAt: toIsoDate(item.pubDate),
  };
  const parsed = HeadlineItemSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function compareHeadlines(a: HeadlineItem, b: HeadlineItem) {
  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : Number.NEGATIVE_INFINITY;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return bTime - aTime;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
}

function dedupeAndLimit(items: HeadlineItem[]) {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const result: HeadlineItem[] = [];

  for (const item of items.sort(compareHeadlines)) {
    if (seenIds.has(item.id) || seenUrls.has(item.googleNewsUrl)) continue;
    seenIds.add(item.id);
    seenUrls.add(item.googleNewsUrl);
    result.push(item);
    if (result.length === MAX_HEADLINES) break;
  }

  return result;
}

export function parseGoogleNewsRss(xml: string): ParsedGoogleNewsFeed {
  if (Buffer.byteLength(xml, "utf8") > MAX_RSS_BYTES) {
    throw new GoogleNewsRssError("The Google News RSS response is too large.");
  }
  if (FORBIDDEN_XML_DECLARATION.test(xml)) {
    throw new GoogleNewsRssError(
      "Google News RSS must not contain DOCTYPE or ENTITY declarations.",
    );
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new GoogleNewsRssError("Google News returned malformed RSS XML.");
  }

  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
      maxNestedTags: MAX_XML_DEPTH,
      processEntities: {
        enabled: true,
        maxEntitySize: 1024,
        maxExpansionDepth: 4,
        maxTotalExpansions: 10_000,
        maxExpandedLength: MAX_RSS_BYTES,
        maxEntityCount: 1,
        allowedTags: [
          "title",
          "link",
          "guid",
          "pubDate",
          "lastBuildDate",
          "source",
        ],
      },
      isArray: (_tagName, path) => path === "rss.channel.item",
      updateTag: (tagName) => (tagName === "description" ? false : tagName),
    }).parse(xml);
  } catch (error) {
    throw new GoogleNewsRssError("Google News returned malformed RSS XML.", {
      cause: error,
    });
  }

  const root = asRecord(document);
  const rss = asRecord(root?.rss);
  const channel = asRecord(rss?.channel);
  if (!channel) {
    throw new GoogleNewsRssError(
      "Google News RSS did not contain an RSS channel.",
    );
  }

  const rawItems = Array.isArray(channel.item)
    ? channel.item
    : channel.item === undefined
      ? []
      : [channel.item];
  const normalized = rawItems.flatMap((item) => {
    const parsed = normalizeItem(item);
    return parsed ? [parsed] : [];
  });

  return {
    items: dedupeAndLimit(normalized),
    feedUpdatedAt: toIsoDate(channel.lastBuildDate ?? channel.pubDate),
  };
}
