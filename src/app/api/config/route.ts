import { dataResponse } from "@/lib/api-response";
import { getDatabaseUrl } from "@/lib/env";
import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIWebSearchContextSize,
  isOpenAIWebSearchEnabled,
} from "@/lib/flowpath-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return dataResponse({
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    webSearchEnabled: isOpenAIWebSearchEnabled(),
    webSearchContextSize: getOpenAIWebSearchContextSize(),
    databaseUrl: getDatabaseUrl().startsWith("file:")
      ? getDatabaseUrl()
      : "remote libSQL database",
  });
}
