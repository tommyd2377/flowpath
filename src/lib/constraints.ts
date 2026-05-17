import type {
  ConstraintSensitivity,
  ContextConstraints,
  MemoryPersistence,
  SocialConnectionContext,
} from "./types";
import { assertSafeTextFields, ProhibitedDataError } from "./privacy";

export type ConstraintCategory = keyof ContextConstraints;

export const constraintCategoryDefinitions: Array<{
  key: ConstraintCategory;
  label: string;
  description: string;
}> = [
  {
    key: "financial_context",
    label: "Money",
    description:
      "Money constraints can change the best next move. Choose the least specific option that is still useful. FlowPath does not need exact account balances.",
  },
  {
    key: "location",
    label: "Location",
    description:
      "Location can affect the realistic next move. Give the least precise location that helps. Do not use an exact address.",
  },
  {
    key: "time_availability",
    label: "Time",
    description: "Use a broad time constraint, such as weekdays, evenings, or a few hours per week.",
  },
  {
    key: "energy_capacity",
    label: "Energy",
    description:
      "Use practical capacity language. FlowPath does not need medical records or a diagnosis.",
  },
  {
    key: "education_or_credentials",
    label: "Education/credentials",
    description:
      "FlowPath only needs education, training, credentials, proof, or track record if it affects the path.",
  },
  {
    key: "domain_access",
    label: "Access/connections",
    description:
      "Do you have people who understand this domain or can help you get closer to real decision-makers?",
  },
  {
    key: "support_network",
    label: "Support network",
    description: "Name the practical support available at a high level, or say if safe support is limited.",
  },
  {
    key: "dependents_or_caregiving",
    label: "Family/caregiving",
    description: "Use broad caregiving or dependent constraints only when they affect what is realistic.",
  },
  {
    key: "transportation",
    label: "Transportation",
    description: "Use a practical access constraint, such as reliable car, transit only, or limited travel.",
  },
  {
    key: "urgent_deadline",
    label: "Deadline",
    description: "Name the deadline broadly enough to shape the plan.",
  },
  {
    key: "safety_or_emergency_risk",
    label: "Safety risk",
    description:
      "Use this only for the current plan. If there is immediate danger, contact local emergency services or appropriate human support.",
  },
  {
    key: "age_range",
    label: "Age/life stage",
    description:
      "Age or life stage can change which options are realistic. Use a range or skip this; FlowPath does not need your date of birth.",
  },
  {
    key: "social_connection",
    label: "Connection/dating",
    description:
      "FlowPath can help with friendship, community, dating, romance, or sexual connection by using broad, consent-centered constraints. Keep intimate details session-only.",
  },
  {
    key: "other",
    label: "Other",
    description: "Add another broad constraint only if it changes the recommendation.",
  },
];

export const educationCredentialOptions = [
  "high school/GED",
  "some college",
  "associate degree",
  "bachelor's degree",
  "graduate/professional degree",
  "trade certification",
  "self-taught",
  "currently in school",
  "portfolio/proof-of-work",
  "prefer not to say",
] as const;

export function shouldPersistConstraint(
  _sensitivity: ConstraintSensitivity,
  persistence?: MemoryPersistence,
) {
  return persistence === "save_broad_constraint";
}

function cleanString(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  assertSafeTextFields({ value: trimmed });
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

function cleanPersistence(value: unknown): MemoryPersistence {
  return value === "save_broad_constraint" ? "save_broad_constraint" : "session_only";
}

function cleanArray<T extends string>(value: T[] | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function cleanTextConstraint(
  value: { value?: string; persistence?: MemoryPersistence } | undefined,
  maxLength = 1000,
) {
  if (!value) return undefined;
  return {
    value: cleanString(value.value, maxLength),
    persistence: cleanPersistence(value.persistence),
  };
}

function cleanMultiConstraint<T extends string>(
  value: { values?: T[]; persistence?: MemoryPersistence } | undefined,
) {
  if (!value) return undefined;
  return {
    values: cleanArray(value.values),
    persistence: cleanPersistence(value.persistence),
  };
}

function pruneSocialConnection(
  input: SocialConnectionContext,
): SocialConnectionContext | undefined {
  const compact = Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (value === undefined) return [];
      if (Array.isArray(value)) return value.length > 0 ? [[key, value]] : [];
      if (!value || typeof value !== "object") return [];
      const child = Object.fromEntries(
        Object.entries(value).filter(([, childValue]) => {
          if (childValue === undefined || childValue === "") return false;
          if (Array.isArray(childValue)) return childValue.length > 0;
          return true;
        }),
      );
      const hasDecisionSignal = Object.entries(child).some(
        ([childKey, childValue]) =>
          childKey !== "persistence" &&
          childValue !== undefined &&
          childValue !== "" &&
          (!Array.isArray(childValue) || childValue.length > 0),
      );
      return hasDecisionSignal ? [[key, child]] : [];
    }),
  ) as SocialConnectionContext;

  return Object.keys(compact).length > 0 ? compact : undefined;
}

function sanitizeSocialConnectionForSession(
  input: SocialConnectionContext,
): SocialConnectionContext | undefined {
  return pruneSocialConnection({
    patterns: cleanArray(input.patterns),
    desired_connection: cleanMultiConstraint(input.desired_connection),
    social_energy: input.social_energy
      ? {
          value: input.social_energy.value,
          persistence: cleanPersistence(input.social_energy.persistence),
        }
      : undefined,
    preferred_settings: cleanMultiConstraint(input.preferred_settings),
    barriers: cleanMultiConstraint(input.barriers),
    existing_connection_surface: cleanTextConstraint(
      input.existing_connection_surface,
      1000,
    ),
    repeatable_contexts_available: cleanTextConstraint(
      input.repeatable_contexts_available,
      1000,
    ),
    safe_people_to_contact: input.safe_people_to_contact
      ? {
          value: input.safe_people_to_contact.value,
          notes: cleanString(input.safe_people_to_contact.notes, 1000),
          persistence: cleanPersistence(input.safe_people_to_contact.persistence),
        }
      : undefined,
    dating_intention: input.dating_intention
      ? {
          value: input.dating_intention.value,
          persistence: cleanPersistence(input.dating_intention.persistence),
        }
      : undefined,
    dating_environment: cleanMultiConstraint(input.dating_environment),
    attraction_or_partner_preferences: cleanTextConstraint(
      input.attraction_or_partner_preferences,
      1000,
    ),
    consent_and_safety_constraints: input.consent_and_safety_constraints
      ? {
          value: cleanString(input.consent_and_safety_constraints.value, 1000),
          persistence: "session_only",
        }
      : undefined,
    avoid_contexts: cleanTextConstraint(input.avoid_contexts, 1000),
    crisis_or_immediate_safety_risk: input.crisis_or_immediate_safety_risk
      ? {
          value: input.crisis_or_immediate_safety_risk.value,
          persistence: "session_only",
        }
      : undefined,
  });
}

function socialConnectionForProfile(
  input: SocialConnectionContext,
): SocialConnectionContext | undefined {
  const safe = sanitizeSocialConnectionForSession(input);
  if (!safe) return undefined;
  const output: SocialConnectionContext = {};

  const persistMulti = <T extends string>(
    value: { values?: T[]; persistence?: MemoryPersistence } | undefined,
  ) =>
    value?.persistence === "save_broad_constraint"
      ? { ...value, persistence: "save_broad_constraint" as const }
      : undefined;

  const persistSingle = <T extends string>(
    value: { value?: T; persistence?: MemoryPersistence } | undefined,
  ) =>
    value?.persistence === "save_broad_constraint"
      ? { ...value, persistence: "save_broad_constraint" as const }
      : undefined;

  output.desired_connection = persistMulti(safe.desired_connection);
  output.social_energy = persistSingle(safe.social_energy);
  output.preferred_settings = persistMulti(safe.preferred_settings);
  output.barriers = persistMulti(safe.barriers);
  output.existing_connection_surface = persistSingle(
    safe.existing_connection_surface,
  );
  output.repeatable_contexts_available = persistSingle(
    safe.repeatable_contexts_available,
  );
  output.safe_people_to_contact =
    safe.safe_people_to_contact?.persistence === "save_broad_constraint"
      ? {
          ...safe.safe_people_to_contact,
          persistence: "save_broad_constraint",
        }
      : undefined;
  output.dating_intention = persistSingle(safe.dating_intention);
  output.dating_environment = persistMulti(safe.dating_environment);
  output.attraction_or_partner_preferences = persistSingle(
    safe.attraction_or_partner_preferences,
  );
  output.avoid_contexts = persistSingle(safe.avoid_contexts);

  return pruneSocialConnection(output);
}

export function sanitizeContextConstraintsForSession(
  input: ContextConstraints,
): ContextConstraints {
  const output: ContextConstraints = {};

  if (input.location) {
    output.location = {
      value: cleanString(input.location.value, 240),
      precision: input.location.precision,
      persistence: cleanPersistence(input.location.persistence),
    };
  }
  if (input.age_range) {
    output.age_range = {
      value: input.age_range.value,
      persistence: cleanPersistence(input.age_range.persistence),
    };
  }
  if (input.life_stage) {
    output.life_stage = {
      value: cleanString(input.life_stage.value, 500),
      persistence: cleanPersistence(input.life_stage.persistence),
    };
  }
  if (input.education_or_credentials) {
    output.education_or_credentials = {
      value: cleanString(input.education_or_credentials.value, 1000),
      persistence: cleanPersistence(input.education_or_credentials.persistence),
    };
  }
  if (input.financial_context) {
    output.financial_context = {
      pressure_level: input.financial_context.pressure_level,
      runway: input.financial_context.runway,
      monthly_cash_flow: input.financial_context.monthly_cash_flow,
      urgent_risks: input.financial_context.urgent_risks,
      persistence: cleanPersistence(input.financial_context.persistence),
    };
  }
  if (input.time_availability) {
    output.time_availability = {
      value: cleanString(input.time_availability.value, 500),
      persistence: cleanPersistence(input.time_availability.persistence),
    };
  }
  if (input.energy_capacity) {
    output.energy_capacity = {
      value: cleanString(input.energy_capacity.value, 500),
      persistence: cleanPersistence(input.energy_capacity.persistence),
    };
  }
  if (input.dependents_or_caregiving) {
    output.dependents_or_caregiving = {
      value: cleanString(input.dependents_or_caregiving.value, 500),
      persistence: cleanPersistence(input.dependents_or_caregiving.persistence),
    };
  }
  if (input.transportation) {
    output.transportation = {
      value: cleanString(input.transportation.value, 500),
      persistence: cleanPersistence(input.transportation.persistence),
    };
  }
  if (input.support_network) {
    output.support_network = {
      value: cleanString(input.support_network.value, 1000),
      persistence: cleanPersistence(input.support_network.persistence),
    };
  }
  if (input.domain_access) {
    output.domain_access = {
      value: input.domain_access.value,
      notes: cleanString(input.domain_access.notes, 1000),
      persistence: cleanPersistence(input.domain_access.persistence),
    };
  }
  if (input.proof_or_track_record) {
    output.proof_or_track_record = {
      value: cleanString(input.proof_or_track_record.value, 1000),
      persistence: cleanPersistence(input.proof_or_track_record.persistence),
    };
  }
  if (input.urgent_deadline) {
    output.urgent_deadline = {
      value: cleanString(input.urgent_deadline.value, 500),
      persistence: cleanPersistence(input.urgent_deadline.persistence),
    };
  }
  if (input.safety_or_emergency_risk) {
    output.safety_or_emergency_risk = {
      value: input.safety_or_emergency_risk.value,
      persistence: "session_only",
    };
  }
  if (input.social_connection) {
    output.social_connection = sanitizeSocialConnectionForSession(
      input.social_connection,
    );
  }
  if (input.other) {
    output.other = {
      value: cleanString(input.other.value, 1000),
      persistence: cleanPersistence(input.other.persistence),
    };
  }

  return pruneEmptyConstraints(output);
}

export function constraintsForProfile(input: ContextConstraints): ContextConstraints {
  const safe = sanitizeContextConstraintsForSession(input);
  const output: ContextConstraints = {};

  for (const [key, value] of Object.entries(safe) as Array<
    [ConstraintCategory, ContextConstraints[ConstraintCategory]]
  >) {
    if (!value || key === "safety_or_emergency_risk") continue;
    if (key === "social_connection") {
      output.social_connection = socialConnectionForProfile(
        value as SocialConnectionContext,
      );
      continue;
    }
    if (!("persistence" in value) || value.persistence !== "save_broad_constraint") {
      continue;
    }
    if (key === "location") {
      const location = value as NonNullable<ContextConstraints["location"]>;
      if (location.precision === "county_or_zip") {
        throw new ProhibitedDataError("location");
      }
      output.location = { ...location, persistence: "save_broad_constraint" };
      continue;
    }
    output[key] = { ...value, persistence: "save_broad_constraint" } as never;
  }

  return pruneEmptyConstraints(output);
}

export function mergeContextConstraints(
  base: ContextConstraints,
  incoming: ContextConstraints,
) {
  return pruneEmptyConstraints({
    ...base,
    ...incoming,
    social_connection: pruneSocialConnection({
      ...(base.social_connection ?? {}),
      ...(incoming.social_connection ?? {}),
    }),
  });
}

export function pruneEmptyConstraints(input: ContextConstraints): ContextConstraints {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const compactValue = Object.fromEntries(
        Object.entries(value).filter(([, childValue]) => {
          if (childValue === undefined || childValue === "") return false;
          if (Array.isArray(childValue)) return childValue.length > 0;
          return true;
        }),
      );
      const hasDecisionSignal = Object.entries(compactValue).some(
        ([key, childValue]) =>
          key !== "persistence" &&
          childValue !== undefined &&
          childValue !== "" &&
          (!Array.isArray(childValue) || childValue.length > 0),
      );
      return hasDecisionSignal ? [[key, compactValue]] : [];
    }),
  ) as ContextConstraints;
}
