import assert from "node:assert/strict";
import test from "node:test";

import { AtlasApiError, errorResponse } from "./http";

test("typed errors preserve call consumption without exposing their cause", async () => {
  const response = errorResponse(
    new AtlasApiError({
      code: "model_incomplete",
      message: "The analysis service returned an incomplete result.",
      status: 502,
      retryable: true,
      callConsumed: true,
      cause: new Error("secret upstream payload"),
    }),
  );
  const body = (await response.json()) as {
    error: { code: string; message: string; callConsumed: boolean };
  };

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "model_incomplete");
  assert.equal(body.error.callConsumed, true);
  assert.doesNotMatch(JSON.stringify(body), /secret upstream payload/i);
});

test("unexpected errors are sanitized as non-call-consuming internal errors", async () => {
  const response = errorResponse(new Error("database password and stack"));
  const body = (await response.json()) as {
    error: { code: string; message: string; callConsumed: boolean };
  };

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.callConsumed, false);
  assert.doesNotMatch(JSON.stringify(body), /password|stack/i);
});
