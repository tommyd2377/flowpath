import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoProhibitedData,
  findProhibitedData,
  ProhibitedDataError,
} from "./privacy";

test("prohibited data guard blocks obvious sensitive identifiers", () => {
  assert.equal(findProhibitedData("My SSN is 123-45-6789"), "ssn");
  assert.equal(
    findProhibitedData("routing number 021000021 and account 123456789"),
    "bank_account",
  );
  assert.equal(findProhibitedData("date of birth: 01/02/1990"), "exact_date_of_birth");
  assert.equal(findProhibitedData("I live at 123 Main Street"), "exact_address");
});

test("prohibited data guard allows broad constraints", () => {
  assert.doesNotThrow(() =>
    assertNoProhibitedData("Runway is 1-3 months and location is NYC metro."),
  );
  assert.doesNotThrow(() =>
    assertNoProhibitedData(
      "Last month was about 35 applications, 8 outreach messages, 2 replies, and no interviews.",
    ),
  );
});

test("prohibited data guard throws before persistence", () => {
  assert.throws(
    () => assertNoProhibitedData("bank login password:=secret"),
    ProhibitedDataError,
  );
});
