import "server-only";

import { createClient } from "@libsql/client";

import {
  ensureLocalDatabaseDirectory,
  resolveWorldDatabaseUrl,
} from "./world-database-config";
import { LibsqlWorldRepository } from "./world-libsql-repository";
import {
  createMemoryWorldRepository,
  type WorldRepository,
} from "./world-repository";
import { createWorldRepositoryProvider } from "./world-repository-provider";

const provider = createWorldRepositoryProvider({
  createPersistent() {
    const url = resolveWorldDatabaseUrl();
    ensureLocalDatabaseDirectory(url);
    return new LibsqlWorldRepository(createClient({ url }));
  },
  createFixture: createMemoryWorldRepository,
});

export function getWorldRepository(): WorldRepository {
  return provider.get();
}

export function setWorldRepositoryForTests(
  next: WorldRepository | null,
  mode: "live" | "fixture" = "live",
) {
  provider.setForTests(next, mode);
}
