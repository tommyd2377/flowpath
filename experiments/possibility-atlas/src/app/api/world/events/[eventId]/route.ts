import { z } from "zod";

import { getWorldRepository } from "@/lib/server/world-db";
import { AtlasApiError, errorResponse, jsonResponse } from "@/lib/server/http";
import { WorldEventDetailResponseSchema } from "@/lib/world-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const result = z.string().uuid().safeParse((await params).eventId);
    if (!result.success) {
      throw new AtlasApiError({
        code: "invalid_event_id",
        message: "The world event ID is invalid.",
        status: 400,
        retryable: false,
        callConsumed: false,
      });
    }
    const detail = await getWorldRepository().getWorldEventDetail(result.data);
    if (!detail) {
      throw new AtlasApiError({
        code: "world_event_not_found",
        message: "That world event is no longer available.",
        status: 404,
        retryable: false,
        callConsumed: false,
      });
    }
    return jsonResponse(
      WorldEventDetailResponseSchema.parse({ ok: true, ...detail }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
