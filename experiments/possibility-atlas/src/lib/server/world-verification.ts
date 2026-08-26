import type { EventSnapshot } from "../contracts";
import type { WorldEventSummary } from "../world-contracts";
import { AtlasApiError } from "./http";
import type { WorldRepository } from "./world-repository";

export async function persistVerifiedWorldSnapshot(input: {
  repository: WorldRepository;
  event: WorldEventSummary;
  snapshot: EventSnapshot;
  callConsumed: boolean;
}) {
  try {
    const committed = await input.repository.markEventVerified(
      input.event.id,
      input.snapshot,
      {
        revision: input.event.revision,
        leadHeadline: input.event.leadHeadline,
      },
    );
    if (!committed) {
      throw new AtlasApiError({
        code: "world_event_changed",
        message:
          "This world event changed while it was being verified. Choose the current event to continue.",
        status: 409,
        retryable: false,
        callConsumed: input.callConsumed,
      });
    }
  } catch (error) {
    if (error instanceof AtlasApiError) throw error;
    throw new AtlasApiError({
      code: "analysis_persistence_failed",
      message: "The completed analysis could not be saved safely.",
      status: 500,
      retryable: true,
      callConsumed: input.callConsumed,
      cause: error,
    });
  }
}
