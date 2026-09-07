import { createHash } from "node:crypto";

import { MAX_ATLAS_CALLS } from "../contracts";
import { AtlasApiError } from "./http";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1_000;
const COMPLETED_CACHE_TTL_MS = 30 * 1_000;

type ActiveRequest = {
  key: string;
  promise: Promise<unknown>;
};

type CompletedRequest = {
  expiresAt: number;
  value: unknown;
};

type InstallationState = {
  timestamps: number[];
  active: ActiveRequest | null;
  completed: Map<string, CompletedRequest>;
  atlasCalls: Map<string, number>;
};

const states = new Map<string, InstallationState>();

function stateFor(installationId: string) {
  let state = states.get(installationId);
  if (!state) {
    state = {
      timestamps: [],
      active: null,
      completed: new Map(),
      atlasCalls: new Map(),
    };
    states.set(installationId, state);
  }
  return state;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function atlasIdempotencyKey(scope: string, payload: unknown) {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(JSON.stringify(stableValue(payload)))
    .digest("hex");
}

export function atlasSafetyIdentifier(installationId: string) {
  return `pa_${createHash("sha256").update(installationId).digest("hex").slice(0, 48)}`;
}

function prune(state: InstallationState, now: number) {
  state.timestamps = state.timestamps.filter(
    (timestamp) => timestamp > now - RATE_WINDOW_MS,
  );
  for (const [key, entry] of state.completed) {
    if (entry.expiresAt <= now) state.completed.delete(key);
  }
}

export async function runWithAtlasRequestGuard<T>(options: {
  installationId: string;
  key: string;
  graphId?: string;
  consumesAtlasCall?: boolean;
  operation: () => Promise<T>;
  now?: () => number;
}): Promise<{ value: T; deduplicated: boolean }> {
  const now = options.now?.() ?? Date.now();
  const state = stateFor(options.installationId);
  prune(state, now);

  const completed = state.completed.get(options.key);
  if (completed) {
    return { value: completed.value as T, deduplicated: true };
  }

  if (state.active) {
    if (state.active.key === options.key) {
      return {
        value: (await state.active.promise) as T,
        deduplicated: true,
      };
    }
    throw new AtlasApiError({
      code: "analysis_in_progress",
      message: "Another analysis request is already running for this installation.",
      status: 409,
      retryable: true,
      callConsumed: false,
      retryAfterSeconds: 1,
    });
  }

  if (state.timestamps.length >= RATE_LIMIT) {
    const oldest = state.timestamps[0] ?? now;
    throw new AtlasApiError({
      code: "rate_limit_exceeded",
      message: "The hourly analysis request limit has been reached.",
      status: 429,
      retryable: true,
      callConsumed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + RATE_WINDOW_MS - now) / 1_000),
      ),
    });
  }

  let reservedAtlasCall = false;
  if (options.consumesAtlasCall) {
    if (!options.graphId) {
      throw new AtlasApiError({
        code: "internal_error",
        message: "The request could not be completed.",
        status: 500,
        retryable: false,
        callConsumed: false,
      });
    }
    const callsUsed = state.atlasCalls.get(options.graphId) ?? 0;
    if (callsUsed >= MAX_ATLAS_CALLS) {
      throw new AtlasApiError({
        code: "atlas_call_limit_reached",
        message: `This atlas has reached its ${MAX_ATLAS_CALLS}-call analysis limit.`,
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }
    state.atlasCalls.set(options.graphId, callsUsed + 1);
    reservedAtlasCall = true;
  }

  const releaseReservedAtlasCall = () => {
    if (!reservedAtlasCall || !options.graphId) return;
    const callsUsed = state.atlasCalls.get(options.graphId) ?? 1;
    if (callsUsed <= 1) state.atlasCalls.delete(options.graphId);
    else state.atlasCalls.set(options.graphId, callsUsed - 1);
    reservedAtlasCall = false;
  };

  state.timestamps.push(now);
  const promise = Promise.resolve().then(options.operation);
  state.active = { key: options.key, promise };

  try {
    const value = await promise;
    if (
      reservedAtlasCall &&
      !(
        value !== null &&
        typeof value === "object" &&
        "meta" in value &&
        (value as { meta?: { callConsumed?: unknown } }).meta?.callConsumed === true
      )
    ) {
      releaseReservedAtlasCall();
    }
    state.completed.set(options.key, {
      value,
      expiresAt: (options.now?.() ?? Date.now()) + COMPLETED_CACHE_TTL_MS,
    });
    return { value, deduplicated: false };
  } catch (error) {
    if (error instanceof AtlasApiError && !error.callConsumed) {
      releaseReservedAtlasCall();
    }
    throw error;
  } finally {
    if (state.active?.promise === promise) state.active = null;
  }
}

export function resetAtlasRequestGuardForTests() {
  states.clear();
}

