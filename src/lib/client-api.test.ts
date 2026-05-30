import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorMessage } from "./client-api";

test("api error messages stay readable when payload fields are objects", () => {
  assert.equal(
    apiErrorMessage({
      error: {
        message: "The saved plan finished after the browser connection closed.",
      },
    }),
    "The saved plan finished after the browser connection closed.",
  );

  assert.equal(
    apiErrorMessage({
      error: { code: "timeout" },
      details: [{ message: "Reloaded the latest saved plan." }],
    }),
    "Reloaded the latest saved plan.",
  );
});
