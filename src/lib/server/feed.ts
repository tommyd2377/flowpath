import {
  ErrorResponseSchema,
  HeadlinesResponseSchema,
  type ErrorResponse,
  type HeadlineItem,
} from "../contracts";
import {
  GoogleNewsRssError,
  MAX_RSS_BYTES,
  parseGoogleNewsRss,
} from "./rss";

export const GOOGLE_NEWS_RSS_URL =
  "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
export const FEED_TIMEOUT_MS = 8_000;
export const FRESH_CACHE_MS = 10 * 60 * 1_000;
export const STALE_CACHE_MS = 24 * 60 * 60 * 1_000;

const ACCEPTED_XML_TYPES = new Set([
  "application/rss+xml",
  "application/xml",
  "text/xml",
]);
const STALE_WARNING =
  "Showing cached headlines because Google News could not be refreshed.";

export type HeadlinesResponse = {
  ok: true;
  items: HeadlineItem[];
  fetchedAt: string;
  feedUpdatedAt: string | null;
  stale: boolean;
  warning: string | null;
};

type CachedFeed = Omit<HeadlinesResponse, "stale" | "warning"> & {
  cachedAtMs: number;
};

type FeedErrorCode =
  | "HEADLINES_TIMEOUT"
  | "HEADLINES_UPSTREAM_ERROR"
  | "HEADLINES_INVALID_CONTENT_TYPE"
  | "HEADLINES_FEED_TOO_LARGE"
  | "HEADLINES_INVALID_XML";

export class HeadlineFeedError extends Error {
  constructor(
    readonly code: FeedErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HeadlineFeedError";
  }
}

type FetchImplementation = typeof fetch;

export type HeadlineFeedServiceOptions = {
  fetchImpl?: FetchImplementation;
  now?: () => number;
};

function acceptedContentType(response: Response) {
  const value = response.headers.get("content-type");
  if (!value) return false;
  return ACCEPTED_XML_TYPES.has(value.split(";", 1)[0].trim().toLowerCase());
}

async function readBoundedBody(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RSS_BYTES) {
      throw new HeadlineFeedError(
        "HEADLINES_FEED_TOO_LARGE",
        "Google News returned more headline data than this app accepts.",
        502,
        false,
      );
    }
  }
  if (!response.body) {
    throw new HeadlineFeedError(
      "HEADLINES_UPSTREAM_ERROR",
      "Google News returned an empty response.",
      502,
      true,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RSS_BYTES) {
        await reader.cancel();
        throw new HeadlineFeedError(
          "HEADLINES_FEED_TOO_LARGE",
          "Google News returned more headline data than this app accepts.",
          502,
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new HeadlineFeedError(
      "HEADLINES_INVALID_XML",
      "Google News returned invalid UTF-8 RSS data.",
      502,
      false,
      { cause: error },
    );
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function normalizeFetchError(error: unknown): HeadlineFeedError {
  if (error instanceof HeadlineFeedError) return error;
  if (error instanceof GoogleNewsRssError) {
    return new HeadlineFeedError(
      "HEADLINES_INVALID_XML",
      error.message,
      502,
      false,
      { cause: error },
    );
  }
  if (isTimeoutError(error)) {
    return new HeadlineFeedError(
      "HEADLINES_TIMEOUT",
      "Google News did not respond within eight seconds.",
      504,
      true,
      { cause: error },
    );
  }
  return new HeadlineFeedError(
    "HEADLINES_UPSTREAM_ERROR",
    "Google News headlines are temporarily unavailable.",
    502,
    true,
    { cause: error },
  );
}

export function headlineFeedErrorResponse(error: unknown): {
  body: ErrorResponse;
  status: number;
} {
  const normalized = normalizeFetchError(error);
  return {
    body: ErrorResponseSchema.parse({
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        callConsumed: false,
      },
    }),
    status: normalized.status,
  };
}

export function createHeadlineFeedService({
  fetchImpl = fetch,
  now = Date.now,
}: HeadlineFeedServiceOptions = {}) {
  let cached: CachedFeed | null = null;
  let refreshInFlight: Promise<CachedFeed> | null = null;

  async function fetchFresh(): Promise<CachedFeed> {
    let response: Response;
    try {
      response = await fetchImpl(GOOGLE_NEWS_RSS_URL, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers: {
          Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        },
      });
    } catch (error) {
      throw normalizeFetchError(error);
    }

    if (!response.ok) {
      throw new HeadlineFeedError(
        "HEADLINES_UPSTREAM_ERROR",
        `Google News returned HTTP ${response.status}.`,
        502,
        true,
      );
    }
    if (!acceptedContentType(response)) {
      throw new HeadlineFeedError(
        "HEADLINES_INVALID_CONTENT_TYPE",
        "Google News returned a response that was not RSS XML.",
        502,
        false,
      );
    }

    try {
      const xml = await readBoundedBody(response);
      const parsed = parseGoogleNewsRss(xml);
      const cachedAtMs = now();
      const result = {
        ok: true as const,
        items: parsed.items,
        fetchedAt: new Date(cachedAtMs).toISOString(),
        feedUpdatedAt: parsed.feedUpdatedAt,
        cachedAtMs,
      };
      HeadlinesResponseSchema.parse({
        ok: true,
        items: result.items,
        fetchedAt: result.fetchedAt,
        feedUpdatedAt: result.feedUpdatedAt,
        stale: false,
        warning: null,
      });
      return result;
    } catch (error) {
      throw normalizeFetchError(error);
    }
  }

  function refresh() {
    if (!refreshInFlight) {
      refreshInFlight = fetchFresh()
        .then((fresh) => {
          cached = fresh;
          return fresh;
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  return {
    async getHeadlines(): Promise<HeadlinesResponse> {
      const requestTime = now();
      const age = cached
        ? Math.max(0, requestTime - cached.cachedAtMs)
        : Number.POSITIVE_INFINITY;
      if (cached && age < FRESH_CACHE_MS) {
        return HeadlinesResponseSchema.parse({
          ok: true,
          items: cached.items,
          fetchedAt: cached.fetchedAt,
          feedUpdatedAt: cached.feedUpdatedAt,
          stale: false,
          warning: null,
        });
      }

      try {
        const fresh = await refresh();
        return HeadlinesResponseSchema.parse({
          ok: true,
          items: fresh.items,
          fetchedAt: fresh.fetchedAt,
          feedUpdatedAt: fresh.feedUpdatedAt,
          stale: false,
          warning: null,
        });
      } catch (error) {
        const staleAge = cached
          ? Math.max(0, now() - cached.cachedAtMs)
          : Number.POSITIVE_INFINITY;
        if (cached && staleAge <= STALE_CACHE_MS) {
          return HeadlinesResponseSchema.parse({
            ok: true,
            items: cached.items,
            fetchedAt: cached.fetchedAt,
            feedUpdatedAt: cached.feedUpdatedAt,
            stale: true,
            warning: STALE_WARNING,
          });
        }
        throw normalizeFetchError(error);
      }
    },
  };
}

export const headlineFeedService = createHeadlineFeedService();
