import { z } from "zod";

import type { ErrorResponse } from "../contracts";

const MAX_REQUEST_BYTES = 128 * 1024;

type AtlasApiErrorOptions = {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  callConsumed: boolean;
  retryAfterSeconds?: number;
  cause?: unknown;
};

export class AtlasApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly callConsumed: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AtlasApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AtlasApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.callConsumed = options.callConsumed;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export async function parseJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new AtlasApiError({
      code: "unsupported_media_type",
      message: "Send the request body as JSON.",
      status: 415,
      retryable: false,
      callConsumed: false,
    });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw requestTooLargeError();
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch (error) {
    throw new AtlasApiError({
      code: "invalid_request_body",
      message: "The request body could not be read.",
      status: 400,
      retryable: false,
      callConsumed: false,
      cause: error,
    });
  }

  if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
    throw requestTooLargeError();
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new AtlasApiError({
      code: "invalid_json",
      message: "The request body is not valid JSON.",
      status: 400,
      retryable: false,
      callConsumed: false,
      cause: error,
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AtlasApiError({
      code: "invalid_request",
      message: "The request body does not match the expected shape.",
      status: 400,
      retryable: false,
      callConsumed: false,
      cause: parsed.error,
    });
  }

  return parsed.data;
}

function requestTooLargeError() {
  return new AtlasApiError({
    code: "request_too_large",
    message: "The request body is too large.",
    status: 413,
    retryable: false,
    callConsumed: false,
  });
}

export function normalizeAtlasError(
  error: unknown,
  fallbackCallConsumed = false,
): AtlasApiError {
  if (error instanceof AtlasApiError) return error;

  return new AtlasApiError({
    code: fallbackCallConsumed ? "analysis_unavailable" : "internal_error",
    message: fallbackCallConsumed
      ? "The analysis service did not complete this request."
      : "The request could not be completed.",
    status: fallbackCallConsumed ? 502 : 500,
    retryable: fallbackCallConsumed,
    callConsumed: fallbackCallConsumed,
    cause: error,
  });
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; mode?: "live" | "fixture" } = {},
) {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (init.mode) headers.set("x-possibility-atlas-mode", init.mode);

  return Response.json(body, {
    status: init.status ?? 200,
    headers,
  });
}

export function errorResponse(error: unknown) {
  const normalized = normalizeAtlasError(error);
  const body: ErrorResponse = {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      callConsumed: normalized.callConsumed,
    },
  };
  const response = jsonResponse(body, { status: normalized.status });
  if (normalized.retryAfterSeconds !== undefined) {
    response.headers.set("retry-after", String(normalized.retryAfterSeconds));
  }
  return response;
}

export function markResponseDeduplicated<
  T extends { meta: { mode: "live" | "fixture"; callConsumed: boolean } },
>(response: T): T {
  // A replay still represents the original model call. Keeping this true lets a
  // client that lost the first response recover the correct per-atlas counter;
  // reducer replay-safety prevents an already-applied response counting twice.
  return response;
}
