import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MAX_HEADLINES } from "../contracts";
import {
  GoogleNewsRssError,
  MAX_RSS_BYTES,
  parseGoogleNewsRss,
  stripExactPublisherSuffix,
} from "./rss";

const validFixtureUrl = new URL(
  "./__fixtures__/google-news-valid.xml",
  import.meta.url,
);
const doctypeFixtureUrl = new URL(
  "./__fixtures__/google-news-doctype.xml",
  import.meta.url,
);

test("normalizes, sorts, deduplicates, and bounds Google News headlines", async () => {
  const xml = await readFile(validFixtureUrl, "utf8");
  const parsed = parseGoogleNewsRss(xml);

  assert.equal(parsed.feedUpdatedAt, "2026-08-25T15:00:00.000Z");
  assert.deepEqual(
    parsed.items.map((item) => item.title),
    [
      "Markets rally & yields fall",
      "Rates - US",
      "Suffix must remain - Reuters",
      "Undated item",
    ],
  );
  assert.equal(parsed.items[0].publisher, "Reuters");
  assert.equal(parsed.items[0].publisherUrl, "https://www.reuters.com/");
  assert.equal(parsed.items[2].publisher, "AP");
  assert.equal(parsed.items[2].publisherUrl, null);
  assert.equal(parsed.items[3].publishedAt, null);
  assert.equal(parsed.items.every((item) => item.id.length === 64), true);
  assert.equal(JSON.stringify(parsed).includes("ignored()"), false);

  const replay = parseGoogleNewsRss(xml);
  assert.deepEqual(
    replay.items.map((item) => item.id),
    parsed.items.map((item) => item.id),
  );
});

test("strips only the exact publisher suffix", () => {
  assert.equal(stripExactPublisherSuffix("Rates - US - AP", "AP"), "Rates - US");
  assert.equal(
    stripExactPublisherSuffix("Rates - US - Reuters", "AP"),
    "Rates - US - Reuters",
  );
  assert.equal(stripExactPublisherSuffix("AP rates", "AP"), "AP rates");
});

test("returns at most the shared headline limit", () => {
  const items = Array.from({ length: MAX_HEADLINES + 8 }, (_, index) => `
    <item>
      <title>Headline ${index} - Publisher ${index}</title>
      <link>https://news.google.com/rss/articles/story-${index}</link>
      <guid>story-${index}</guid>
      <pubDate>${new Date(Date.UTC(2026, 7, 25, 0, index)).toUTCString()}</pubDate>
      <source url="https://publisher-${index}.example/">Publisher ${index}</source>
    </item>`).join("");
  const parsed = parseGoogleNewsRss(`<rss><channel>${items}</channel></rss>`);

  assert.equal(parsed.items.length, MAX_HEADLINES);
  assert.equal(parsed.items[0].title, `Headline ${MAX_HEADLINES + 7}`);
});

test("rejects DOCTYPE and ENTITY declarations before parsing", async () => {
  const xml = await readFile(doctypeFixtureUrl, "utf8");
  assert.throws(() => parseGoogleNewsRss(xml), GoogleNewsRssError);
  assert.throws(
    () =>
      parseGoogleNewsRss(
        "<rss><channel><!entity unsafe 'x'></channel></rss>",
      ),
    GoogleNewsRssError,
  );
});

test("rejects malformed, deeply nested, and oversized XML", () => {
  assert.throws(
    () => parseGoogleNewsRss("<rss><channel><item></channel></rss>"),
    GoogleNewsRssError,
  );
  const deep = `${"<a>".repeat(40)}${"</a>".repeat(40)}`;
  assert.throws(
    () => parseGoogleNewsRss(`<rss><channel>${deep}</channel></rss>`),
    GoogleNewsRssError,
  );
  assert.throws(
    () => parseGoogleNewsRss(" ".repeat(MAX_RSS_BYTES + 1)),
    GoogleNewsRssError,
  );
});
