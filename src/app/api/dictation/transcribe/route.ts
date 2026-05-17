import OpenAI from "openai";
import type { Transcription } from "openai/resources/audio/transcriptions";

import { ApiRequestError, dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const MAX_DICTATION_AUDIO_BYTES = 25 * 1024 * 1024;

function usageMetadata(usage: Transcription["usage"] = undefined) {
  if (!usage || usage.type !== "tokens") return {};
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }

    await assertCanUseFeature(user.id, "lightweight_assist");

    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      throw new ApiRequestError("Upload an audio recording to transcribe.", 400, "missing_audio");
    }
    if (audio.size <= 0) {
      throw new ApiRequestError("The audio recording was empty.", 400, "empty_audio");
    }
    if (audio.size > MAX_DICTATION_AUDIO_BYTES) {
      throw new ApiRequestError(
        "Dictation recordings must be smaller than 25 MB.",
        413,
        "audio_too_large",
      );
    }
    if (audio.type && !audio.type.toLowerCase().startsWith("audio/")) {
      throw new ApiRequestError("Upload a valid audio recording.", 400, "invalid_audio");
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
      response_format: "json",
    });

    await incrementUsage(user.id, "lightweight_assist", usageMetadata(transcription.usage));

    return dataResponse({ text: transcription.text.trim() });
  } catch (error) {
    return errorResponse(error, "Could not transcribe dictation.");
  }
}
