import { dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIWebSearchContextSize,
  isOpenAIWebSearchEnabled,
} from "@/lib/flowpath-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return dataResponse({
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      webSearchEnabled: isOpenAIWebSearchEnabled(),
      webSearchContextSize: getOpenAIWebSearchContextSize(),
    });
  } catch (error) {
    return errorResponse(error, "Could not load app config.");
  }
}
