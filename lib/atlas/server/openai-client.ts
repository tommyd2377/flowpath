import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import { AtlasApiError } from "./http";

export const DEFAULT_ATLAS_MODEL = "gpt-5.6-luna";

export type AtlasServerMode = "live" | "fixture";

export type AtlasResponsesRequest = {
  model: string;
  store: false;
  reasoning: { effort: "low" | "none" };
  max_output_tokens: number;
  input: Array<{
    role: "system" | "developer" | "user";
    content: string;
  }>;
  text: {
    format: unknown;
    verbosity: "low";
  };
  safety_identifier?: string;
  tools?: Array<{
    type: "web_search";
    search_context_size: "low" | "medium";
  }>;
  tool_choice?: "required";
  max_tool_calls?: 1 | 2;
  parallel_tool_calls?: false;
  include?: Array<"web_search_call.action.sources">;
};

export type AtlasRequestOptions = {
  timeout: number;
  maxRetries: 0;
  signal?: AbortSignal | null;
};

export type AtlasParsedResponse<T> = {
  status?: string | null;
  output_parsed: T | null;
  output: Array<unknown>;
  incomplete_details?: { reason?: string | null } | null;
  error?: unknown;
  _request_id?: string | null;
};

export interface AtlasResponsesAdapter {
  parse<T>(
    request: AtlasResponsesRequest,
    options: AtlasRequestOptions,
  ): Promise<AtlasParsedResponse<T>>;
}

let clientPromise: Promise<OpenAI> | null = null;

export function resolveAtlasServerMode(
  environment: NodeJS.ProcessEnv = process.env,
): AtlasServerMode {
  if (environment.VOICE_FIXTURE_MODE === "1") {
    if (environment.NODE_ENV === "production") {
      throw new AtlasApiError({
        code: "fixture_mode_forbidden",
        message: "Fixture mode is unavailable in production.",
        status: 503,
        retryable: false,
        callConsumed: false,
      });
    }
    return "fixture";
  }

  if (environment.VOICE_ANALYSIS_ENABLED === "0") {
    throw new AtlasApiError({
      code: "analysis_disabled",
      message: "Live voice analysis is not enabled.",
      status: 503,
      retryable: false,
      callConsumed: false,
    });
  }

  return "live";
}

export function getAtlasModel(environment: NodeJS.ProcessEnv = process.env) {
  const model =
    environment.VOICE_ANALYSIS_MODEL?.trim() || DEFAULT_ATLAS_MODEL;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
    throw new AtlasApiError({
      code: "analysis_misconfigured",
      message: "The analysis model configuration is invalid.",
      status: 503,
      retryable: false,
      callConsumed: false,
    });
  }
  return model;
}

async function getOpenAIClient(environment: NodeJS.ProcessEnv = process.env) {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AtlasApiError({
      code: "analysis_misconfigured",
      message: "The analysis service is not configured.",
      status: 503,
      retryable: false,
      callConsumed: false,
    });
  }

  clientPromise ??= import("openai").then(({ default: OpenAIClient }) =>
    new OpenAIClient({
      apiKey,
      maxRetries: 0,
    }),
  );
  return clientPromise;
}

const liveAdapter: AtlasResponsesAdapter = {
  async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions) {
    const client = await getOpenAIClient();
    const apiRequest = request as ResponseCreateParamsNonStreaming & {
      max_tool_calls?: number;
    };
    const response = await client.responses.parse(apiRequest, options);
    return response as unknown as AtlasParsedResponse<T>;
  },
};

export function getAtlasResponsesAdapter(): AtlasResponsesAdapter {
  return liveAdapter;
}
