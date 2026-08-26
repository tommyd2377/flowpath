import { resolveOptionalRawAtlasCallLedger } from "./optional-call-ledger-core";
import type { AtlasCallLedger } from "./request-guard";
import { getWorldRepository } from "./world-db";

export async function getOptionalRawAtlasCallLedger(): Promise<
  AtlasCallLedger | undefined
> {
  return resolveOptionalRawAtlasCallLedger(getWorldRepository);
}
