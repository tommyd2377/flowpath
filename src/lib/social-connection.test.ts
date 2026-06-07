import assert from "node:assert/strict";
import test from "node:test";

import {
  immediateDangerCopy,
  isCrisisSupportText,
  isImmediateDangerText,
  isSocialConnectionSituation,
  usCrisisSupportCopy,
} from "./social-connection";

test("loneliness and social isolation route to social connection domain", () => {
  assert.equal(
    isSocialConnectionSituation({
      title: "I feel lonely and isolated",
      category: "social",
    }),
    true,
  );
});

test("dating and romance route to social connection domain", () => {
  assert.equal(
    isSocialConnectionSituation({
      title: "I want dating or romantic connection",
      category: "dating",
    }),
    true,
  );
});

test("sexual partner seeking routes to social connection domain", () => {
  assert.equal(
    isSocialConnectionSituation({
      title: "I want sexual connection safely",
      category: "sexual_connection",
    }),
    true,
  );
});

test("crisis and immediate danger text route to support copy", () => {
  assert.equal(isCrisisSupportText("I feel suicidal and need crisis support"), true);
  assert.equal(isCrisisSupportText("I want to not be alive anymore"), true);
  assert.equal(isImmediateDangerText("Someone is in immediate danger right now"), true);
  assert.match(usCrisisSupportCopy, /call or text 988/i);
  assert.match(usCrisisSupportCopy, /988 Lifeline chat/i);
  assert.match(immediateDangerCopy, /call 911 or your local emergency number/i);
});
