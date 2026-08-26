import {
  RegisterAtlasRequestSchema,
} from "@/lib/contracts";
import { registerSavedAtlas } from "@/lib/server/graph-registration";
import {
  errorResponse,
  jsonResponse,
  parseJsonRequest,
} from "@/lib/server/http";
import {
  getAtlasModel,
  getWorldAtlasModel,
} from "@/lib/server/openai-client";
import { getWorldRepository } from "@/lib/server/world-db";
import { resolveWorldRepositoryMode } from "@/lib/server/world-database-config";

export const runtime = "nodejs";
const MAX_REGISTER_REQUEST_BYTES = 512 * 1024;

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, RegisterAtlasRequestSchema, {
      maxBytes: MAX_REGISTER_REQUEST_BYTES,
    });
    const mode = resolveWorldRepositoryMode();
    return jsonResponse(
      await registerSavedAtlas(input, {
        mode,
        getAtlasModel,
        getWorldAtlasModel,
        getWorldRepository,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
