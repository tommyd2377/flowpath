import type { HeadlineItem } from "../contracts";
import {
  WorldRefreshResponseSchema,
  type WorldRefreshResponse,
} from "../world-contracts";
import type { HeadlinesResponse } from "./feed";
import type { AtlasResponsesAdapter } from "./openai-client";
import {
  atlasIdempotencyKey,
  runWithAtlasRequestGuard,
} from "./request-guard";
import {
  classifyWorldHeadlinesWithOpenAI,
  WORLD_CLASSIFICATION_MODEL,
  worldFeedFingerprint,
} from "./world-classifier";
import { createFixtureWorldClassification } from "./world-fixtures";
import {
  WORLD_EVENT_RETENTION_MS,
  type WorldRepository,
} from "./world-repository";
import { AtlasApiError } from "./http";

type WorldRefreshOptions = {
  installationId: string;
  mode: "live" | "fixture";
  repository: WorldRepository;
  adapter?: AtlasResponsesAdapter;
  getHeadlines?: () => Promise<HeadlinesResponse>;
  signal?: AbortSignal | null;
  now?: () => Date;
};

const refreshesByFingerprint = new Map<
  string,
  Promise<WorldRefreshResponse>
>();

async function responseFromRepository(
  repository: WorldRepository,
  meta: WorldRefreshResponse["meta"],
) {
  return WorldRefreshResponseSchema.parse({
    ...(await repository.getCatalogSnapshot()),
    meta,
  });
}

export async function refreshWorldCatalog(
  options: WorldRefreshOptions,
): Promise<WorldRefreshResponse> {
  await options.repository.initialize();

  if (options.mode === "fixture") {
    const fixture = createFixtureWorldClassification();
    const metadata = await options.repository.getCatalogMetadata();
    if (metadata.feedFingerprint === fixture.feedFingerprint) {
      return responseFromRepository(options.repository, {
        mode: "fixture",
        callConsumed: false,
        cacheStatus: "hit",
      });
    }
    await options.repository.commitClassification(fixture);
    return responseFromRepository(options.repository, {
      mode: "fixture",
      callConsumed: false,
      cacheStatus: "miss",
    });
  }

  if (!options.adapter || !options.getHeadlines) {
    throw new Error("Live world refresh dependencies are unavailable.");
  }
  const feed = await options.getHeadlines();
  const headlines: HeadlineItem[] = feed.items;
  const fingerprint = worldFeedFingerprint(headlines);
  const metadata = await options.repository.getCatalogMetadata();
  if (metadata.feedFingerprint === fingerprint) {
    return responseFromRepository(options.repository, {
      mode: "live",
      callConsumed: false,
      cacheStatus: "hit",
    });
  }

  const active = refreshesByFingerprint.get(fingerprint);
  if (active) {
    const shared = await active;
    return WorldRefreshResponseSchema.parse({
      ...shared,
      meta: { mode: "live", callConsumed: false, cacheStatus: "hit" },
    });
  }

  const refreshPromise = runWithAtlasRequestGuard<WorldRefreshResponse>({
    installationId: options.installationId,
    key: atlasIdempotencyKey("world:refresh", { fingerprint }),
    operation: async () => {
        const rechecked = await options.repository.getCatalogMetadata();
        if (rechecked.feedFingerprint === fingerprint) {
          return responseFromRepository(options.repository, {
            mode: "live",
            callConsumed: false,
            cacheStatus: "hit",
          });
        }
        const scannedAt = (options.now?.() ?? new Date()).toISOString();
        const scannedAtMs = Date.parse(scannedAt);
        const existingEvents = (
          await options.repository.listMatchableEvents()
        ).filter(
          (event) =>
            scannedAtMs - Date.parse(event.lastSeenAt) <
            WORLD_EVENT_RETENTION_MS,
        );
        const commit = await classifyWorldHeadlinesWithOpenAI({
          installationId: options.installationId,
          headlines,
          existingEvents,
          feedFingerprint: fingerprint,
          scannedAt,
          adapter: options.adapter!,
          model: WORLD_CLASSIFICATION_MODEL,
          signal: options.signal,
        });
        try {
          await options.repository.commitClassification(commit);
          return await responseFromRepository(options.repository, {
            mode: "live",
            callConsumed: true,
            cacheStatus: "miss",
          });
        } catch (error) {
          throw new AtlasApiError({
            code: "world_catalog_write_failed",
            message: "The completed world analysis could not be saved atomically.",
            status: 500,
            retryable: true,
            callConsumed: true,
            cause: error,
          });
        }
      },
  });
  const responsePromise = refreshPromise.then((result) => result.value);
  refreshesByFingerprint.set(fingerprint, responsePromise);
  try {
    return await responsePromise;
  } finally {
    if (refreshesByFingerprint.get(fingerprint) === responsePromise) {
      refreshesByFingerprint.delete(fingerprint);
    }
  }
}

export function resetWorldRefreshForTests() {
  refreshesByFingerprint.clear();
}
