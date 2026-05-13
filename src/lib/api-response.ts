import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
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
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        code: "validation_error",
        details: error.issues.map((issue) => issue.message).join(" "),
      },
      { status: 400 },
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
