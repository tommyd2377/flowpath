import { randomUUID } from "node:crypto";
import type { z } from "zod";

import { MAX_ATLAS_CALLS, StartAtlasRequestSchema, type StartAtlasResponse, type ExpandAtlasResponse, type EventSnapshot } from "../contracts";
import { CuratedStorySchema, type CuratedStory } from "../../story-contracts";
import { expandAtlasWithOpenAI, validateExpansionContext, type ExpandAtlasRequest } from "./branch";
import { createFixtureExpansionResponse, createFixtureStartResponse } from "./fixtures";
import { GenerationCacheRepository, REGISTERED_GRAPH_RETENTION_MS, waitForGenerationTemplate } from "./generation-cache";
import {
  EXPANSION_PROMPT_VERSION, ExpansionGenerationTemplateSchema,
  expansionResponseToTemplate, generationCacheKey, generationFingerprint,
  materializeExpansionTemplate, materializeStartTemplate, semanticExpansionSource,
  START_PROMPT_VERSION, StartGenerationTemplateSchema, startResponseToTemplate,
} from "./generation-templates";
import { commitRegisteredExpansion, getRegisteredExpansionResponse, getRegisteredStartResponse, registerStartedGraph, validateRegisteredExpansion } from "./graph-registry";
import { AtlasApiError } from "./http";
import { getAtlasModel, getAtlasResponsesAdapter, resolveAtlasServerMode, type AtlasResponsesAdapter, type AtlasServerMode } from "./openai-client";
import { atlasIdempotencyKey, atlasSafetyIdentifier, runWithAtlasRequestGuard } from "./request-guard";
import { startAtlasWithOpenAI } from "./verify";

export type StartInput = z.infer<typeof StartAtlasRequestSchema>;
export type StartGenerationProgress = {
  context?: CuratedStory;
  onResearch?: (snapshot: EventSnapshot) => void;
};
export type GenerationService = {
  start(input: StartInput, signal?: AbortSignal, progress?: StartGenerationProgress): Promise<StartAtlasResponse>;
  expand(input: ExpandAtlasRequest, signal?: AbortSignal): Promise<ExpandAtlasResponse>;
};

function unavailable(code: string, message: string, status = 409, retryable = false, retryAfterSeconds?: number) {
  return new AtlasApiError({ code, message, status, retryable, retryAfterSeconds, callConsumed: false });
}

/** Flowpath's guarded generation pipeline, callable by the server voice controller. */
export function createGenerationService(options: {
  repository: GenerationCacheRepository;
  mode?: () => AtlasServerMode;
  adapter?: AtlasResponsesAdapter;
  model?: string;
}): GenerationService {
  const repository = options.repository;

  async function maintain() {
    const maintenanceNow = Date.now();
    await repository.runMaintenance({
      ownerToken: randomUUID(), now: maintenanceNow,
      graphOlderThan: new Date(maintenanceNow - REGISTERED_GRAPH_RETENTION_MS).toISOString(),
      stateOlderThan: maintenanceNow - REGISTERED_GRAPH_RETENTION_MS,
    });
  }

  async function requestReservation(installationId: string) {
    const result = await repository.reserveInstallationRequest({
      installationKey: atlasSafetyIdentifier(installationId),
      reservationToken: randomUUID(), now: Date.now(),
    });
    if (!result.reserved) throw unavailable("rate_limit_exceeded", "The hourly analysis request limit has been reached.", 429, true, result.retryAfterSeconds);
  }

  async function template<T>(input: {
    installationId: string;
    graphId: string;
    kind: "start" | "expand";
    source: unknown;
    promptVersion: string;
    schema: z.ZodType<T>;
    generate(mode: AtlasServerMode): Promise<{ payload: T; createdAt: string }>;
    signal?: AbortSignal;
  }) {
    input.signal?.throwIfAborted();
    const mode = options.mode?.() ?? resolveAtlasServerMode();
    if (mode === "fixture" && process.env.NODE_ENV === "production") {
      throw unavailable("fixture_mode_forbidden", "Fixture mode is unavailable in production.", 503);
    }
    const model = `${mode === "fixture" ? "fixture:" : ""}${options.model ?? getAtlasModel()}`;
    const key = generationCacheKey({ kind: input.kind, model, promptVersion: input.promptVersion, source: input.source });
    const cached = await repository.get(key, input.schema);
    if (cached) return { ...cached, mode, callConsumed: false, cacheStatus: "hit" as const };
    const ownerToken = randomUUID();
    const ownsLease = await repository.acquireLease({ key, ownerToken, now: Date.now(), ttlMs: 120_000 });
    if (!ownsLease) {
      const waited = await waitForGenerationTemplate({ repository, key, schema: input.schema, signal: input.signal });
      input.signal?.throwIfAborted();
      if (!waited) throw unavailable("analysis_in_progress", "This analysis is already being created. Try again in a moment.", 409, true, 1);
      return { ...waited, mode, callConsumed: false, cacheStatus: "hit" as const };
    }

    const installationKey = atlasSafetyIdentifier(input.installationId);
    let releaseCall = false;
    let consumed = false;
    let active = false;
    const reservationToken = randomUUID();
    try {
      input.signal?.throwIfAborted();
      const call = await repository.reserveAtlasCall({ graphId: input.graphId, installationKey, now: new Date().toISOString() });
      if (!call.ownerMatches) throw unavailable("graph_conflict", "This exploration belongs to another installation.");
      if (!call.reserved) throw unavailable("atlas_call_limit_reached", `This exploration has reached its ${MAX_ATLAS_CALLS}-call analysis limit.`);
      releaseCall = true;
      const installation = await repository.reserveInstallationGeneration({ installationKey, reservationToken, now: Date.now(), ttlMs: 120_000 });
      if (!installation.reserved) throw unavailable("analysis_in_progress", "Another analysis is still finishing.", 409, true, installation.retryAfterSeconds);
      active = true;
      const guarded = await runWithAtlasRequestGuard({
        installationId: input.installationId, key, graphId: input.graphId, consumesAtlasCall: false,
        operation: async () => {
          input.signal?.throwIfAborted();
          // Fixture mode follows the same limits without making any paid call.
          const generated = await input.generate(mode);
          consumed = true;
          try {
            return await repository.put({ key, kind: input.kind, model,
              promptVersion: input.promptVersion, sourceFingerprint: generationFingerprint(input.source),
              payload: generated.payload, createdAt: generated.createdAt,
              expiresAt: null,
            }, input.schema);
          } catch (cause) {
            throw new AtlasApiError({ code: "analysis_persistence_failed", message: "The completed analysis could not be saved safely.", status: 503, retryable: true, callConsumed: true, cause });
          }
        },
      });
      releaseCall = false;
      return { ...guarded.value, mode, callConsumed: true, cacheStatus: guarded.deduplicated ? "hit" as const : "miss" as const };
    } catch (error) {
      if (consumed || (error instanceof AtlasApiError && error.callConsumed)) releaseCall = false;
      throw error;
    } finally {
      if (active) await repository.releaseInstallationGeneration({ installationKey, reservationToken, now: Date.now() }).catch(() => undefined);
      if (releaseCall) await repository.releaseAtlasCall({ graphId: input.graphId, installationKey, now: new Date().toISOString() }).catch(() => undefined);
      await repository.releaseLease(key, ownerToken).catch(() => undefined);
    }
  }

  return {
    async start(input, signal, progress) {
      StartAtlasRequestSchema.parse(input);
      const context = progress?.context ? CuratedStorySchema.parse(progress.context) : undefined;
      if (context && context.id !== input.headline.id) {
        throw unavailable("story_context_mismatch", "The story context does not match the selected headline.", 400);
      }
      signal?.throwIfAborted();
      if ((options.mode?.() ?? resolveAtlasServerMode()) === "fixture" && process.env.NODE_ENV === "production") {
        throw unavailable("fixture_mode_forbidden", "Fixture mode is unavailable in production.", 503);
      }
      await maintain();
      const replay = await getRegisteredStartResponse(input, { repository });
      if (replay) return replay;
      await requestReservation(input.installationId);
      let publishedResearch: EventSnapshot | undefined;
      const onResearch = progress?.onResearch ? (snapshot: EventSnapshot) => {
        signal?.throwIfAborted();
        publishedResearch = snapshot;
        progress.onResearch?.(snapshot);
      } : undefined;
      const result = await template({
        ...input, kind: "start", source: context ? { headline: input.headline, initialCatalogContext: context } : input.headline,
        promptVersion: START_PROMPT_VERSION,
        schema: StartGenerationTemplateSchema.options[0], signal,
        async generate(mode) {
          const response = mode === "fixture" ? createFixtureStartResponse(input)
            : await startAtlasWithOpenAI(input, { adapter: options.adapter ?? getAtlasResponsesAdapter(), model: options.model ?? getAtlasModel(), signal, context, onResearch });
          if (response.kind !== "atlas") throw unavailable("model_output_invalid", "The analysis service did not return a possibility map.", 502);
          if (mode === "fixture") onResearch?.(response.snapshot);
          return { payload: StartGenerationTemplateSchema.options[0].parse(startResponseToTemplate(response)),
            createdAt: response.snapshot.capturedAt };
        },
      });
      const response = materializeStartTemplate(result.payload, input, {
        ...result, capturedAt: result.createdAt, snapshotId: publishedResearch?.id,
      });
      return registerStartedGraph(input, response, { repository });
    },
    async expand(input, signal) {
      signal?.throwIfAborted();
      await maintain();
      const expansion = validateExpansionContext(input);
      const requestKey = atlasIdempotencyKey("voice:expand", input);
      const replay = await getRegisteredExpansionResponse(input, requestKey, { repository });
      if (replay) return replay;
      await validateRegisteredExpansion(input, { repository });
      await requestReservation(input.installationId);
      const result = await template({
        ...input, kind: "expand", promptVersion: EXPANSION_PROMPT_VERSION,
        source: semanticExpansionSource({ snapshot: input.snapshot, lineage: input.lineage, maxBranches: expansion.maxBranches }),
        schema: ExpansionGenerationTemplateSchema, signal,
        async generate(mode) {
          const response = mode === "fixture" ? createFixtureExpansionResponse(input)
            : await expandAtlasWithOpenAI(input, { adapter: options.adapter ?? getAtlasResponsesAdapter(), model: options.model ?? getAtlasModel(), signal });
          return { payload: expansionResponseToTemplate(response), createdAt: new Date().toISOString() };
        },
      });
      const response = materializeExpansionTemplate(result.payload, {
        parentId: input.parentId, nextDepth: expansion.nextDepth, maxBranches: expansion.maxBranches,
      }, result);
      return commitRegisteredExpansion(input, requestKey, response, { repository });
    },
  };
}
