import { mkdirSync } from "node:fs";
import path from "node:path";

import { AtlasApiError } from "./http";

export const DEFAULT_WORLD_DATABASE_URL =
  "file:./data/possibility-atlas.db";

export function resolveWorldDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const url =
    environment.POSSIBILITY_ATLAS_DATABASE_URL?.trim() ||
    DEFAULT_WORLD_DATABASE_URL;
  if (!/^file:\.\/data\/[A-Za-z0-9._-]+\.db$/.test(url)) {
    throw new AtlasApiError({
      code: "world_database_misconfigured",
      message: "The local World in Motion database is not configured correctly.",
      status: 503,
      retryable: false,
      callConsumed: false,
    });
  }
  return url;
}

export function ensureLocalDatabaseDirectory(url: string) {
  resolveWorldDatabaseUrl({
    ...process.env,
    POSSIBILITY_ATLAS_DATABASE_URL: url,
  });
  mkdirSync(path.resolve(process.cwd(), "data"), { recursive: true });
}

export function resolveWorldRepositoryMode(
  environment: NodeJS.ProcessEnv = process.env,
): "live" | "fixture" {
  if (environment.POSSIBILITY_ATLAS_FIXTURE_MODE !== "1") return "live";
  if (environment.NODE_ENV === "production") {
    throw new AtlasApiError({
      code: "fixture_mode_forbidden",
      message: "Fixture mode is unavailable in production.",
      status: 503,
      retryable: false,
      callConsumed: false,
    });
  }
  return "fixture";
}
