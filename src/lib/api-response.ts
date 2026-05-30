import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ProhibitedDataError } from "./privacy";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiRequestError("Invalid JSON body.", 400, "invalid_json");
  }
}

export function dataResponse<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function emptyResponse(status = 204) {
  return new NextResponse(null, { status });
}

function providerErrorResponse(error: unknown) {
  const providerError = error as {
    status?: number;
    code?: string | null;
    type?: string | null;
    error?: { code?: string | null; type?: string | null };
  };
  const status = providerError?.status;
  const code = providerError?.code ?? providerError?.error?.code;
  const type = providerError?.type ?? providerError?.error?.type;

  if (status === 429 && (code === "insufficient_quota" || type === "insufficient_quota")) {
    return NextResponse.json(
      {
        error:
          "FlowPath cannot continue because the configured OpenAI API project is out of quota or billing credits. Check the OpenAI API billing/quota settings, then try again.",
        code: "openai_insufficient_quota",
      },
      { status: 503 },
    );
  }

  if (status === 429) {
    return NextResponse.json(
      {
        error:
          "FlowPath is being rate-limited by the configured AI provider. Wait a moment, then try again.",
        code: "provider_rate_limited",
      },
      { status: 503 },
    );
  }

  return null;
}

export function errorResponse(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
      maximum: "maximum" in issue ? issue.maximum : undefined,
    }));
    const details = issues.map((issue) => {
      const field = issue.path ? `${issue.path}: ` : "";
      return `${field}${issue.message}`;
    });

    return NextResponse.json(
      {
        error: details[0] ?? "Please check the highlighted fields.",
        code: "validation_error",
        details: details.join(" "),
        issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof ProhibitedDataError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.field },
      { status: error.status },
    );
  }

  const providerResponse = providerErrorResponse(error);
  if (providerResponse) return providerResponse;

  console.error(error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiRequestError("Invalid id.", 400, "invalid_id");
  }
  return id;
}
