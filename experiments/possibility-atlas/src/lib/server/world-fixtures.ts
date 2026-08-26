import { createHash } from "node:crypto";

import type { HeadlineItem } from "../contracts";
import type { WorldClassificationModelOutput } from "../world-contracts";
import {
  materializeWorldClassification,
  WORLD_CLASSIFICATION_MODEL,
  worldFeedFingerprint,
} from "./world-classifier";
import type { WorldClassificationCommit } from "./world-repository";

function fixtureId(seed: string) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = "8";
  const compact = chars.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export const WORLD_FIXTURE_HEADLINES: HeadlineItem[] = [
  ["fixture-tariff-001", "Major trading partners announce a new tariff package", "Fixture Wire"],
  ["fixture-tariff-002", "Manufacturers assess potential response to tariff package", "Fixture Business"],
  ["fixture-energy-001", "Shipping disruption raises concern over regional energy supplies", "Fixture Global"],
  ["fixture-energy-002", "Energy markets watch key shipping route after disruption", "Fixture Markets"],
  ["fixture-rates-001", "Central bank officials face a changing inflation outlook", "Fixture Economy"],
  ["fixture-election-001", "Coalition talks begin after an inconclusive national election", "Fixture Politics"],
  ["fixture-weather-001", "Routine weekend weather outlook released", "Fixture Weather"],
].map(([id, title, publisher], index) => ({
  id,
  title,
  publisher,
  publisherUrl: `https://${publisher.toLowerCase().replace(/\s+/g, "-")}.example/`,
  googleNewsUrl: `https://news.google.com/rss/articles/${id}`,
  publishedAt: `2026-08-25T${String(12 - index).padStart(2, "0")}:00:00.000Z`,
}));

const WORLD_FIXTURE_CLASSIFICATION: WorldClassificationModelOutput = {
  groups: [
    {
      existingEventId: null,
      canonicalTitle: "Trading partners confront a new tariff package",
      summary: "A headline-derived trade-policy event with several unresolved response paths.",
      dimensions: { impact: 3, branchability: 3, connectivity: 3, uncertainty: 2 },
      headlines: [
        { headlineId: "fixture-tariff-001", role: "root" },
        { headlineId: "fixture-tariff-002", role: "supporting" },
      ],
    },
    {
      existingEventId: null,
      canonicalTitle: "Shipping disruption pressures regional energy supply",
      summary: "A headline-derived logistics event that could alter energy availability and prices.",
      dimensions: { impact: 3, branchability: 2, connectivity: 3, uncertainty: 3 },
      headlines: [
        { headlineId: "fixture-energy-001", role: "root" },
        { headlineId: "fixture-energy-002", role: "supporting" },
      ],
    },
    {
      existingEventId: null,
      canonicalTitle: "Central bank weighs a changing inflation outlook",
      summary: "A headline-derived policy event with unresolved implications for future rates.",
      dimensions: { impact: 3, branchability: 2, connectivity: 3, uncertainty: 2 },
      headlines: [{ headlineId: "fixture-rates-001", role: "root" }],
    },
    {
      existingEventId: null,
      canonicalTitle: "Coalition negotiations follow an inconclusive election",
      summary: "A headline-derived political event with multiple plausible governing outcomes.",
      dimensions: { impact: 2, branchability: 3, connectivity: 2, uncertainty: 3 },
      headlines: [{ headlineId: "fixture-election-001", role: "root" }],
    },
  ],
  standaloneHeadlineIds: ["fixture-weather-001"],
};

export const WORLD_FIXTURE_EVENT_IDS = [
  "tariff",
  "energy",
  "rates",
  "election",
].map((seed) => fixtureId(`world-event:${seed}`));
export const WORLD_FIXTURE_FEED_FINGERPRINT = worldFeedFingerprint(
  WORLD_FIXTURE_HEADLINES,
);
export const WORLD_FIXTURE_SCAN_ID = fixtureId(
  `world-scan:${WORLD_FIXTURE_FEED_FINGERPRINT}`,
);

export function createFixtureWorldClassification(
  scannedAt = "2026-08-25T16:00:00.000Z",
): WorldClassificationCommit {
  let index = 0;
  const commit = materializeWorldClassification({
    output: WORLD_FIXTURE_CLASSIFICATION,
    headlines: WORLD_FIXTURE_HEADLINES,
    existingEvents: [],
    feedFingerprint: WORLD_FIXTURE_FEED_FINGERPRINT,
    scannedAt,
    model: WORLD_CLASSIFICATION_MODEL,
    createId: () =>
      WORLD_FIXTURE_EVENT_IDS[index++] ?? fixtureId(`overflow:${index}`),
  });
  return { ...commit, scanId: WORLD_FIXTURE_SCAN_ID };
}
