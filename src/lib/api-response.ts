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
