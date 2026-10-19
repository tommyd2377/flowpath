import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import { AtlasApiError } from "./http";

export const DEFAULT_ATLAS_MODEL = "gpt-6-luna";

export type AtlasServerMode = "live" | "fixture";

export type AtlasResponsesRequest = {
  model: string;
  service_tier: "priority";
  store: false;
  reasoning: { effort: "low" };
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

export type AtlasResponseProgress = {
  outputText: string;
  completedOutput: unknown[];
};

export interface AtlasResponsesAdapter {
  parse<T>(
    request: AtlasResponsesRequest,
    options: AtlasRequestOptions,
  ): Promise<AtlasParsedResponse<T>>;
  stream?<T>(
    request: AtlasResponsesRequest,
    options: AtlasRequestOptions,
    onProgress: (progress: AtlasResponseProgress) => void,
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

export function getAtlasModel() {
  return DEFAULT_ATLAS_MODEL;
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

export function createAtlasResponsesAdapter(getClient: () => Promise<OpenAI>): AtlasResponsesAdapter {
  return {
    async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions) {
      const client = await getClient();
      const apiRequest = {
        ...request,
      } as ResponseCreateParamsNonStreaming & {
        max_tool_calls?: number;
      };
      const response = await client.responses.parse(apiRequest, options);
      return response as unknown as AtlasParsedResponse<T>;
    },
    async stream<T>(
      request: AtlasResponsesRequest,
      options: AtlasRequestOptions,
      onProgress: (progress: AtlasResponseProgress) => void,
    ) {
      const client = await getClient();
      const apiRequest = {
        ...request,
      } as Omit<ResponseCreateParamsNonStreaming, "stream"> & { max_tool_calls?: number };
      // The SDK request timeout ends once SSE headers arrive. Keep the same bound
      // active through the final streamed chunk so a stalled stream cannot outlive
      // its generation lease or keep an installation busy indefinitely.
      const lifetime = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
      const timeout = setTimeout(() => lifetime.abort(), options.timeout);
      try {
        const stream = client.responses.stream(apiRequest, { ...options, signal });
        const completedOutput: unknown[] = [];
        let outputText = "";
        let incompleteResponse: AtlasParsedResponse<T> | undefined;
        stream.on("response.incomplete", (event) => {
          // The SDK parses output_text before returning finalResponse(), including
          // truncated JSON. Preserve the terminal metadata before that parse can
          // obscure the provider's explicit incompletion reason.
          incompleteResponse = { ...event.response, output_parsed: null };
        });
        stream.on("response.output_text.delta", (event) => {
          outputText = event.snapshot;
          onProgress({ outputText, completedOutput: [...completedOutput] });
        });
        stream.on("response.output_item.done", (event) => {
          completedOutput.push(event.item);
          onProgress({ outputText, completedOutput: [...completedOutput] });
        });
        try {
          const response = await stream.finalResponse();
          return response as unknown as AtlasParsedResponse<T>;
        } catch (error) {
          if (incompleteResponse && !signal.aborted) return incompleteResponse;
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

const liveAdapter = createAtlasResponsesAdapter(getOpenAIClient);

export function getAtlasResponsesAdapter(): AtlasResponsesAdapter {
  return liveAdapter;
}
