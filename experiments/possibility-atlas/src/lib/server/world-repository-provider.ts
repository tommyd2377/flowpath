import { resolveWorldRepositoryMode } from "./world-database-config";
import type { WorldRepository } from "./world-repository";

export function createWorldRepositoryProvider(options: {
  createPersistent: () => WorldRepository;
  createFixture: () => WorldRepository;
}) {
  let persistent: WorldRepository | null = null;
  let fixture: WorldRepository | null = null;

  return {
    get(environment: NodeJS.ProcessEnv = process.env) {
      if (resolveWorldRepositoryMode(environment) === "fixture") {
        fixture ??= options.createFixture();
        return fixture;
      }
      persistent ??= options.createPersistent();
      return persistent;
    },
    setForTests(
      next: WorldRepository | null,
      mode: "live" | "fixture" = "live",
    ) {
      if (mode === "fixture") fixture = next;
      else persistent = next;
    },
  };
}
