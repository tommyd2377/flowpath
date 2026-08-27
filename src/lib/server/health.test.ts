import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../../app/api/health/route";

test("health route returns an uncached service status", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "possibility-atlas",
  });
});
