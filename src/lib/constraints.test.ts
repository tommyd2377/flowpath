import assert from "node:assert/strict";
import test from "node:test";

import {
  constraintCategoryDefinitions,
  constraintsForProfile,
  educationCredentialOptions,
  mergeContextConstraints,
  sanitizeContextConstraintsForSession,
  shouldPersistConstraint,
} from "./constraints";
import { ProhibitedDataError } from "./privacy";
import { contextConstraintsInputSchema } from "./schemas";

function definitionText(label: string) {
  const definition = constraintCategoryDefinitions.find((item) => item.label === label);
  assert.ok(definition, `Missing definition for ${label}`);
  return `${definition.label} ${definition.description}`;
}

test("financial constraint copy uses ranges instead of exact balances or net worth", () => {
  const text = definitionText("Money");
  assert.match(text, /least specific option/i);
  assert.doesNotMatch(text, /what is your exact/i);
  assert.doesNotMatch(text, /net worth/i);
});

test("location constraint copy does not request exact address", () => {
  const text = definitionText("Location");
  assert.match(text, /least precise/i);
  assert.doesNotMatch(text, /enter your exact address/i);
});

test("age constraint copy uses range language and not exact date of birth", () => {
  const text = definitionText("Age/life stage");
  assert.match(text, /range/i);
  assert.doesNotMatch(text, /exact date of birth/i);
});

test("support and access copy avoids parent occupation framing", () => {
  const text = `${definitionText("Access/connections")} ${definitionText(
    "Support network",
  )}`;
  assert.doesNotMatch(text, /parents.*occupation/i);
  assert.doesNotMatch(text, /parents.*living/i);
});

test("profile constraints require explicit broad save and never include safety risk", () => {
  const profileConstraints = constraintsForProfile({
    financial_context: {
      pressure_level: "tight",
      persistence: "session_only",
    },
    time_availability: {
      value: "Evenings only",
      persistence: "save_broad_constraint",
    },
    safety_or_emergency_risk: {
      value: "possible",
      persistence: "session_only",
    },
  });

  assert.deepEqual(profileConstraints, {
    time_availability: {
      value: "Evenings only",
      persistence: "save_broad_constraint",
    },
  });
  assert.equal(shouldPersistConstraint("high", "session_only"), false);
  assert.equal(shouldPersistConstraint("high", "save_broad_constraint"), true);
});

test("context constraint schema parses, sanitizes, merges, and round-trips", () => {
  const parsed = contextConstraintsInputSchema.parse({
    context_constraints: {
      financial_context: {
        pressure_level: "tight",
        runway: "1_to_3_months",
        persistence: "session_only",
      },
      time_availability: {
        value: "Evenings only",
        persistence: "save_broad_constraint",
      },
    },
  });
  const sessionConstraints = sanitizeContextConstraintsForSession(
    parsed.context_constraints,
  );
  const profileConstraints = constraintsForProfile(sessionConstraints);
  const merged = mergeContextConstraints(sessionConstraints, profileConstraints);

  assert.deepEqual(merged.financial_context, {
    pressure_level: "tight",
    runway: "1_to_3_months",
    persistence: "session_only",
  });
  assert.deepEqual(merged.time_availability, {
    value: "Evenings only",
    persistence: "save_broad_constraint",
  });
});

test("profile constraints reject county or zip precision", () => {
  assert.throws(
    () =>
      constraintsForProfile({
        location: {
          value: "10001",
          precision: "county_or_zip",
          persistence: "save_broad_constraint",
        },
      }),
    ProhibitedDataError,
  );
});

test("social constraints parse, sanitize, merge, and keep sensitive fields session-only", () => {
  const parsed = contextConstraintsInputSchema.parse({
    context_constraints: {
      social_connection: {
        patterns: ["connection_deficit", "dating_app_stuck"],
        desired_connection: {
          values: ["close_friendship", "romantic_relationship"],
          persistence: "save_broad_constraint",
        },
        social_energy: {
          value: "short_message_or_call",
          persistence: "save_broad_constraint",
        },
        preferred_settings: {
          values: ["structured_group", "low_pressure_public_setting"],
          persistence: "session_only",
        },
        consent_and_safety_constraints: {
          value: "Public first meetings and slower pacing.",
          persistence: "session_only",
        },
        crisis_or_immediate_safety_risk: {
          value: "possible",
          persistence: "session_only",
        },
      },
    },
  });
  const sessionConstraints = sanitizeContextConstraintsForSession(
    parsed.context_constraints,
  );
  const profileConstraints = constraintsForProfile(sessionConstraints);
  const merged = mergeContextConstraints(sessionConstraints, profileConstraints);

  assert.deepEqual(merged.social_connection?.patterns, [
    "connection_deficit",
    "dating_app_stuck",
  ]);
  assert.deepEqual(profileConstraints.social_connection, {
    desired_connection: {
      values: ["close_friendship", "romantic_relationship"],
      persistence: "save_broad_constraint",
    },
    social_energy: {
      value: "short_message_or_call",
      persistence: "save_broad_constraint",
    },
  });
  assert.equal(
    profileConstraints.social_connection?.consent_and_safety_constraints,
    undefined,
  );
  assert.equal(
    profileConstraints.social_connection?.crisis_or_immediate_safety_risk,
    undefined,
  );
  assert.equal(profileConstraints.social_connection?.patterns, undefined);
});

test("education options include non-degree proof signals", () => {
  assert.ok(educationCredentialOptions.includes("self-taught"));
  assert.ok(educationCredentialOptions.includes("portfolio/proof-of-work"));
});
