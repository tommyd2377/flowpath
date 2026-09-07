import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FEED_TIMEOUT_MS,
  FRESH_CACHE_MS,
  GOOGLE_NEWS_RSS_URL,
  HeadlineFeedError,
  STALE_CACHE_MS,
  createHeadlineFeedService,
  headlineFeedErrorResponse,
} from "./feed";
import { MAX_RSS_BYTES } from "./rss";

const fixtureUrl = new URL(
  "./__fixtures__/google-news-valid.xml",
  import.meta.url,
);

function xmlResponse(xml: string, headers?: HeadersInit) {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=UTF-8",
      ...headers,
    },
  });
}

test("uses the fixed Google feed and secure native fetch options", async () => {
  const xml = await readFile(fixtureUrl, "utf8");
  let input: Parameters<typeof fetch>[0] | undefined;
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (nextInput, nextInit) => {
    input = nextInput;
    init = nextInit;
    return xmlResponse(xml);
  };
  const service = createHeadlineFeedService({ fetchImpl, now: () => 1_000 });

  const result = await service.getHeadlines();

  assert.equal(input, GOOGLE_NEWS_RSS_URL);
  assert.equal(init?.cache, "no-store");
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal instanceof AbortSignal);
  assert.equal(FEED_TIMEOUT_MS, 8_000);
  assert.equal(result.stale, false);
  assert.equal(result.warning, null);
});

test("coalesces concurrent refreshes and honors the ten-minute cache", async () => {
  const xml = await readFile(fixtureUrl, "utf8");
  let fetchCount = 0;
  let release: ((response: Response) => void) | undefined;
  const firstResponse = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchImpl: typeof fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1 ? firstResponse : xmlResponse(xml);
  };
  let now = 10_000;
  const service = createHeadlineFeedService({ fetchImpl, now: () => now });

  const first = service.getHeadlines();
  const second = service.getHeadlines();
  assert.equal(fetchCount, 1);
  release?.(xmlResponse(xml));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);

  now += FRESH_CACHE_MS - 1;
  await service.getHeadlines();
  assert.equal(fetchCount, 1);

  now += 2;
  await service.getHeadlines();
  assert.equal(fetchCount, 2);
});

test("serves a 24-hour stale fallback but expires older cache entries", async () => {
  const xml = await readFile(fixtureUrl, "utf8");
  let fail = false;
  const fetchImpl: typeof fetch = async () => {
    if (fail) throw new TypeError("offline");
    return xmlResponse(xml);
  };
  let now = 0;
  const service = createHeadlineFeedService({ fetchImpl, now: () => now });
  const fresh = await service.getHeadlines();
  fail = true;

  now = FRESH_CACHE_MS + 1;
  const stale = await service.getHeadlines();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, fresh.fetchedAt);
  assert.match(stale.warning ?? "", /cached headlines/i);

  now = STALE_CACHE_MS + 1;
  await assert.rejects(
    service.getHeadlines(),
    (error: unknown) =>
      error instanceof HeadlineFeedError &&
      error.code === "HEADLINES_UPSTREAM_ERROR",
  );
});

test("rejects unexpected content types and declared or streamed oversize feeds", async () => {
  const invalidType = createHeadlineFeedService({
    fetchImpl: async () =>
      new Response("<rss />", {
        headers: { "content-type": "text/html" },
      }),
  });
  await assert.rejects(
    invalidType.getHeadlines(),
    (error: unknown) =>
      error instanceof HeadlineFeedError &&
      error.code === "HEADLINES_INVALID_CONTENT_TYPE",
  );

  const declaredOversize = createHeadlineFeedService({
    fetchImpl: async () =>
      xmlResponse("<rss />", {
        "content-length": String(MAX_RSS_BYTES + 1),
      }),
  });
  await assert.rejects(
    declaredOversize.getHeadlines(),
    (error: unknown) =>
      error instanceof HeadlineFeedError &&
      error.code === "HEADLINES_FEED_TOO_LARGE",
  );

  const streamedOversize = createHeadlineFeedService({
    fetchImpl: async () => xmlResponse(" ".repeat(MAX_RSS_BYTES + 1)),
  });
  await assert.rejects(
    streamedOversize.getHeadlines(),
    (error: unknown) =>
      error instanceof HeadlineFeedError &&
      error.code === "HEADLINES_FEED_TOO_LARGE",
  );
});

test("maps timeouts to typed, retryable, non-call-consuming errors", async () => {
  const service = createHeadlineFeedService({
    fetchImpl: async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  });

  const error = await service.getHeadlines().catch((caught) => caught);
  const mapped = headlineFeedErrorResponse(error);
  assert.equal(mapped.status, 504);
  assert.deepEqual(mapped.body, {
    ok: false,
    error: {
      code: "HEADLINES_TIMEOUT",
      message: "Google News did not respond within eight seconds.",
      retryable: true,
      callConsumed: false,
    },
  });
});

