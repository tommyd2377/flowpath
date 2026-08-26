import type { AtlasCallLedger } from "./request-guard";

type InitializableAtlasCallLedger = AtlasCallLedger & {
  initialize(): Promise<void>;
};

export async function resolveOptionalRawAtlasCallLedger(
  getRepository: () => InitializableAtlasCallLedger,
): Promise<AtlasCallLedger | undefined> {
  try {
    const repository = getRepository();
    await repository.initialize();
    return repository;
  } catch {
    // Standalone headline analysis predates the World database. The in-memory
    // request guard remains authoritative for this process when that optional
    // durable ledger is unavailable.
    return undefined;
  }
}
