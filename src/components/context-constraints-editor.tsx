"use client";

import { useState } from "react";

import {
  constraintCategoryDefinitions,
  educationCredentialOptions,
  type ConstraintCategory,
} from "@/lib/constraints";
import type {
  AgeRange,
  ContextConstraints,
  DatingEnvironment,
  DatingIntention,
  DesiredConnectionType,
  DomainAccessLevel,
  FinancialPressureLevel,
  FinancialRunway,
  LocationPrecision,
  MemoryPersistence,
  MonthlyCashFlow,
  SafePeopleToContact,
  SituationSafetyRisk,
  SocialBarrier,
  SocialConnectionPattern,
  SocialCrisisRisk,
  SocialEnergyLevel,
  SocialSettingPreference,
  UrgentFinancialRisk,
} from "@/lib/types";
import {
  AGE_RANGES,
  DATING_ENVIRONMENTS,
  DATING_INTENTIONS,
  DESIRED_CONNECTION_TYPES,
  DOMAIN_ACCESS_LEVELS,
  FINANCIAL_PRESSURE_LEVELS,
  FINANCIAL_RUNWAYS,
  LOCATION_PRECISIONS,
  MONTHLY_CASH_FLOWS,
  SAFE_PEOPLE_TO_CONTACT_OPTIONS,
  SITUATION_SAFETY_RISKS,
  SOCIAL_BARRIERS,
  SOCIAL_CONNECTION_PATTERNS,
  SOCIAL_CRISIS_RISKS,
  SOCIAL_ENERGY_LEVELS,
  SOCIAL_SETTING_PREFERENCES,
  URGENT_FINANCIAL_RISKS,
} from "@/lib/types";
import { Button, Field, SelectInput, TextArea, TextInput } from "./ui";

const financialLabels: Record<FinancialPressureLevel, string> = {
  none: "No pressure",
  manageable: "Manageable",
  tight: "Tight",
  urgent: "Urgent",
  crisis: "Crisis",
  prefer_not_to_say: "Prefer not to say",
};

const runwayLabels: Record<FinancialRunway, string> = {
  under_2_weeks: "Under 2 weeks",
  "2_to_4_weeks": "2-4 weeks",
  "1_to_3_months": "1-3 months",
  "3_to_6_months": "3-6 months",
  "6_plus_months": "6+ months",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const cashFlowLabels: Record<MonthlyCashFlow, string> = {
  short_each_month: "Short each month",
  roughly_break_even: "Roughly break even",
  save_a_little: "Save a little",
  save_comfortably: "Save comfortably",
  irregular: "Irregular",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const urgentRiskLabels: Record<UrgentFinancialRisk, string> = {
  housing: "Housing",
  food: "Food",
  utilities: "Utilities",
  transportation: "Transportation",
  medical_costs: "Medical costs",
  debt_or_collections: "Debt/collections",
  childcare: "Childcare",
  none: "None",
  prefer_not_to_say: "Prefer not to say",
};

const locationLabels: Record<LocationPrecision, string> = {
  none: "No location needed",
  country: "Country",
  state_or_province: "State/province",
  city_or_metro: "City/metro",
  county_or_zip: "County/zip, only for local resources",
};

const ageLabels: Record<AgeRange, string> = {
  under_18: "Under 18",
  "18_24": "18-24",
  "25_34": "25-34",
  "35_49": "35-49",
  "50_64": "50-64",
  "65_plus": "65+",
  prefer_not_to_say: "Prefer not to say",
};

const accessLabels: Record<DomainAccessLevel, string> = {
  insider_access: "Yes, meaningful insider access",
  some_access: "Some access",
  outside_the_system: "Mostly outside the system",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const safetyLabels: Record<SituationSafetyRisk, string> = {
  none: "None",
  possible: "Possible",
  urgent: "Urgent",
  prefer_not_to_say: "Prefer not to say",
};

const socialPatternLabels: Record<SocialConnectionPattern, string> = {
  connection_deficit: "Not enough regular contact",
  depth_deficit: "People around, not enough closeness",
  transition_isolation: "Isolated after a life change",
  avoidance_loop: "Avoiding reaching out",
  skill_or_confidence_gap: "Skill or confidence gap",
  environment_problem: "Environment makes connection hard",
  mistrust_or_safety_problem: "Mistrust or safety concern",
  identity_or_belonging_mismatch: "Belonging mismatch",
  romantic_partner_seeking: "Seeking romance",
  sexual_partner_seeking: "Seeking sexual connection",
  dating_app_stuck: "Stuck on dating apps",
  post_breakup_rebuilding: "Rebuilding after breakup",
  remote_work_isolation: "Remote-work isolation",
  community_reentry: "Re-entering community",
  not_sure: "Not sure",
};

const desiredConnectionLabels: Record<DesiredConnectionType, string> = {
  casual_friendship: "Casual friendship",
  close_friendship: "Close friendship",
  community_belonging: "Community/belonging",
  professional_peers: "Professional peers",
  creative_collaborators: "Creative collaborators",
  family_repair: "Family repair",
  romantic_relationship: "Romantic relationship",
  long_term_partner: "Long-term partner",
  dating_exploration: "Dating exploration",
  sexual_connection: "Sexual connection",
  queer_or_identity_aligned_community: "Queer/identity-aligned community",
  regular_human_contact: "Regular human contact",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const socialEnergyLabels: Record<SocialEnergyLevel, string> = {
  one_tiny_action: "One tiny action",
  short_message_or_call: "One message or short call",
  one_low_pressure_event: "One low-pressure event",
  one_recurring_commitment: "One recurring commitment",
  moderate_capacity: "More than one action",
  high_capacity: "High capacity",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const socialSettingLabels: Record<SocialSettingPreference, string> = {
  in_person: "In person",
  online: "Online",
  either: "Either",
  structured_group: "Structured group",
  one_on_one: "One-on-one",
  activity_based: "Activity-based",
  low_pressure_public_setting: "Low-pressure public setting",
  identity_aligned_community: "Identity-aligned community",
  non_alcohol_centered: "Non-alcohol-centered",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const socialBarrierLabels: Record<SocialBarrier, string> = {
  access: "Access",
  confidence: "Confidence",
  time: "Time",
  money: "Money",
  transportation: "Transportation",
  health_or_energy: "Health/energy",
  fear_of_rejection: "Fear of rejection",
  not_knowing_where_to_go: "Not knowing where to go",
  not_knowing_how_to_follow_up: "Not knowing how to follow up",
  past_hurt_or_mistrust: "Past hurt or mistrust",
  safety_concern: "Safety concern",
  dating_app_fatigue: "Dating app fatigue",
  shame_or_embarrassment: "Shame/embarrassment",
  lack_of_repeated_context: "No repeated social context",
  identity_or_belonging_mismatch: "Not meeting compatible people",
  none: "None",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const safePeopleLabels: Record<SafePeopleToContact, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const datingIntentionLabels: Record<DatingIntention, string> = {
  long_term_relationship: "Long-term relationship",
  casual_dating: "Casual dating",
  sexual_connection: "Sexual connection",
  exploring: "Exploring",
  rebuilding_after_breakup: "Rebuilding after breakup",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const datingEnvironmentLabels: Record<DatingEnvironment, string> = {
  dating_apps: "Dating apps",
  in_person: "In person",
  friends_or_network: "Friends or network",
  hobby_or_activity_groups: "Hobby/activity groups",
  queer_or_identity_specific_spaces: "Queer/identity-specific spaces",
  events_or_social_scenes: "Events/social scenes",
  online_communities: "Online communities",
  not_sure: "Not sure",
  prefer_not_to_say: "Prefer not to say",
};

const socialCrisisLabels: Record<SocialCrisisRisk, string> = {
  none: "None",
  possible: "Possible",
  urgent: "Urgent",
  immediate_danger: "Immediate danger",
  prefer_not_to_say: "Prefer not to say",
};

type Props = {
  value: ContextConstraints;
  onChange?: (constraints: ContextConstraints) => void;
  onSave?: (constraints: ContextConstraints) => Promise<void> | void;
  saving?: boolean;
  profileMode?: boolean;
};

export function ContextConstraintsEditor({
  value,
  onChange,
  onSave,
  saving,
  profileMode = false,
}: Props) {
  const [draft, setDraft] = useState<ContextConstraints>(value ?? {});
  const [active, setActive] = useState<ConstraintCategory>("financial_context");

  function update(next: ContextConstraints) {
    setDraft(next);
    onChange?.(next);
  }

  function updateCategory<K extends ConstraintCategory>(
    key: K,
    nextValue: NonNullable<ContextConstraints[K]>,
  ) {
    update({ ...draft, [key]: nextValue });
  }

  function updateCategories(nextValues: Partial<ContextConstraints>) {
    update({ ...draft, ...nextValues });
  }

  const activeDefinition =
    constraintCategoryDefinitions.find((definition) => definition.key === active) ??
    constraintCategoryDefinitions[0];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {constraintCategoryDefinitions.map((definition) => (
          <button
            key={definition.key}
            type="button"
            onClick={() => setActive(definition.key)}
            className={`rounded-md border px-3 py-2 text-sm transition ${
              active === definition.key
                ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                : "border-slate-800 bg-slate-900 text-slate-300 hover:border-[var(--azure)]"
            }`}
          >
            {definition.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
        <div className="mb-1 text-sm font-semibold text-white">
          {activeDefinition.label}
        </div>
        <p className="mb-4 text-sm text-slate-400">{activeDefinition.description}</p>
        <ConstraintFields
          category={active}
          constraints={draft}
          updateCategory={updateCategory}
          updateCategories={updateCategories}
          profileMode={profileMode}
        />
      </div>

      {onSave ? (
        <div>
          <Button type="button" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? "Saving..." : "Save constraint context"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConstraintFields({
  category,
  constraints,
  updateCategory,
  updateCategories,
  profileMode,
}: {
  category: ConstraintCategory;
  constraints: ContextConstraints;
  updateCategory: <K extends ConstraintCategory>(
    key: K,
    nextValue: NonNullable<ContextConstraints[K]>,
  ) => void;
  updateCategories: (nextValues: Partial<ContextConstraints>) => void;
  profileMode: boolean;
}) {
  const persistence = (current?: MemoryPersistence) =>
    profileMode ? "save_broad_constraint" : current ?? "session_only";

  if (category === "financial_context") {
    const current = constraints.financial_context ?? {};
    return (
      <div className="grid gap-4">
        <SelectField
          label="How urgent is the financial pressure?"
          value={current.pressure_level ?? ""}
          onChange={(value) =>
            updateCategory("financial_context", {
              ...current,
              pressure_level: value as FinancialPressureLevel,
              persistence: persistence(current.persistence),
            })
          }
          options={FINANCIAL_PRESSURE_LEVELS}
          labels={financialLabels}
        />
        <SelectField
          label="How much runway do you have for essentials?"
          value={current.runway ?? ""}
          onChange={(value) =>
            updateCategory("financial_context", {
              ...current,
              runway: value as FinancialRunway,
              persistence: persistence(current.persistence),
            })
          }
          options={FINANCIAL_RUNWAYS}
          labels={runwayLabels}
        />
        <SelectField
          label="Monthly cash flow"
          value={current.monthly_cash_flow ?? ""}
          onChange={(value) =>
            updateCategory("financial_context", {
              ...current,
              monthly_cash_flow: value as MonthlyCashFlow,
              persistence: persistence(current.persistence),
            })
          }
          options={MONTHLY_CASH_FLOWS}
          labels={cashFlowLabels}
        />
        <div>
          <div className="mb-2 text-sm font-medium text-slate-200">
            Any urgent risk in the next 30 days?
          </div>
          <div className="flex flex-wrap gap-2">
            {URGENT_FINANCIAL_RISKS.map((risk) => {
              const selected = current.urgent_risks?.includes(risk) ?? false;
              return (
                <button
                  key={risk}
                  type="button"
                  onClick={() => {
                    const nextRisks = selected
                      ? (current.urgent_risks ?? []).filter((item) => item !== risk)
                      : [...(current.urgent_risks ?? []), risk];
                    updateCategory("financial_context", {
                      ...current,
                      urgent_risks: nextRisks,
                      persistence: persistence(current.persistence),
                    });
                  }}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    selected
                      ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                      : "border-slate-700 text-slate-300"
                  }`}
                >
                  {urgentRiskLabels[risk]}
                </button>
              );
            })}
          </div>
        </div>
        <PersistenceField
          value={current.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateCategory("financial_context", {
              ...current,
              persistence: nextPersistence,
            })
          }
        />
      </div>
    );
  }

  if (category === "location") {
    const current = constraints.location ?? {};
    const precisionOptions = profileMode
      ? LOCATION_PRECISIONS.filter((precision) => precision !== "county_or_zip")
      : LOCATION_PRECISIONS;
    return (
      <div className="grid gap-4">
        <SelectField
          label="Least precise location that helps"
          value={current.precision ?? ""}
          onChange={(value) =>
            updateCategory("location", {
              ...current,
              precision: value as LocationPrecision,
              persistence: persistence(current.persistence),
            })
          }
          options={precisionOptions}
          labels={locationLabels}
        />
        <Field label="Location value" hint="Example: United States, New York, or NYC metro. No exact address.">
          <TextInput
            value={current.value ?? ""}
            onChange={(event) =>
              updateCategory("location", {
                ...current,
                value: event.target.value,
                persistence: persistence(current.persistence),
              })
            }
          />
        </Field>
        <PersistenceField
          value={current.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateCategory("location", { ...current, persistence: nextPersistence })
          }
        />
      </div>
    );
  }

  if (category === "age_range") {
    const current = constraints.age_range ?? {};
    const lifeStage = constraints.life_stage ?? {};
    return (
      <div className="grid gap-4">
        <SelectField
          label="Age range"
          value={current.value ?? ""}
          onChange={(value) =>
            updateCategory("age_range", {
              value: value as AgeRange,
              persistence: persistence(current.persistence),
            })
          }
          options={AGE_RANGES}
          labels={ageLabels}
        />
        <Field label="Life stage" hint="Examples: student, early career, parent/caregiver, returning after a gap.">
          <TextInput
            value={lifeStage.value ?? ""}
            onChange={(event) =>
              updateCategory("life_stage", {
                value: event.target.value,
                persistence: persistence(lifeStage.persistence),
              })
            }
          />
        </Field>
        <PersistenceField
          value={current.persistence ?? lifeStage.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateCategories({
              age_range: { ...current, persistence: nextPersistence },
              life_stage: { ...lifeStage, persistence: nextPersistence },
            })
          }
        />
      </div>
    );
  }

  if (category === "education_or_credentials") {
    const current = constraints.education_or_credentials ?? {};
    return (
      <TextConstraint
        label="Education, training, credentials, proof, or track record"
        value={current.value}
        hint={`Useful examples: ${educationCredentialOptions.join(", ")}.`}
        persistence={current.persistence}
        profileMode={profileMode}
        onChange={(value, nextPersistence) =>
          updateCategory("education_or_credentials", {
            value,
            persistence: nextPersistence,
          })
        }
      />
    );
  }

  if (category === "domain_access") {
    const current = constraints.domain_access ?? {};
    return (
      <div className="grid gap-4">
        <SelectField
          label="Access level"
          value={current.value ?? ""}
          onChange={(value) =>
            updateCategory("domain_access", {
              ...current,
              value: value as DomainAccessLevel,
              persistence: persistence(current.persistence),
            })
          }
          options={DOMAIN_ACCESS_LEVELS}
          labels={accessLabels}
        />
        <Field label="Optional notes" hint="Examples: useful introductions, mentors, professional network, no safe support available.">
          <TextArea
            value={current.notes ?? ""}
            onChange={(event) =>
              updateCategory("domain_access", {
                ...current,
                notes: event.target.value,
                persistence: persistence(current.persistence),
              })
            }
          />
        </Field>
        <PersistenceField
          value={current.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateCategory("domain_access", {
              ...current,
              persistence: nextPersistence,
            })
          }
        />
      </div>
    );
  }

  if (category === "safety_or_emergency_risk") {
    const current = constraints.safety_or_emergency_risk ?? {};
    return (
      <SelectField
        label="Safety or emergency risk"
        value={current.value ?? ""}
        onChange={(value) =>
          updateCategory("safety_or_emergency_risk", {
            value: value as SituationSafetyRisk,
            persistence: "session_only",
          })
        }
        options={SITUATION_SAFETY_RISKS}
        labels={safetyLabels}
      />
    );
  }

  if (category === "social_connection") {
    const current = constraints.social_connection ?? {};
    const updateSocial = (
      nextValue: NonNullable<ContextConstraints["social_connection"]>,
    ) => updateCategory("social_connection", { ...current, ...nextValue });

    return (
      <div className="grid gap-4">
        <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
          FlowPath can help you choose a realistic next move toward real-world
          connection. For dating or sexual connection, keep this broad and
          consent-centered; FlowPath does not provide manipulation tactics or
          explicit sexual coaching.
        </div>

        {!profileMode ? (
          <MultiSelectConstraint
            label="Which feels closest right now?"
            values={current.patterns ?? []}
            options={SOCIAL_CONNECTION_PATTERNS}
            labels={socialPatternLabels}
            onChange={(values) => updateSocial({ patterns: values })}
          />
        ) : null}

        <MultiSelectConstraint
          label="What kind of connection are you trying to build or repair?"
          values={current.desired_connection?.values ?? []}
          options={DESIRED_CONNECTION_TYPES}
          labels={desiredConnectionLabels}
          persistence={current.desired_connection?.persistence}
          profileMode={profileMode}
          onChange={(values, nextPersistence) =>
            updateSocial({
              desired_connection: {
                values,
                persistence: nextPersistence,
              },
            })
          }
        />

        <SelectField
          label="What level of social action feels realistic this week?"
          value={current.social_energy?.value ?? ""}
          onChange={(value) =>
            updateSocial({
              social_energy: {
                value: value as SocialEnergyLevel,
                persistence: persistence(current.social_energy?.persistence),
              },
            })
          }
          options={SOCIAL_ENERGY_LEVELS}
          labels={socialEnergyLabels}
        />
        <PersistenceField
          value={current.social_energy?.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateSocial({
              social_energy: {
                ...current.social_energy,
                persistence: nextPersistence,
              },
            })
          }
        />

        <MultiSelectConstraint
          label="What kind of setting would feel most realistic?"
          values={current.preferred_settings?.values ?? []}
          options={SOCIAL_SETTING_PREFERENCES}
          labels={socialSettingLabels}
          persistence={current.preferred_settings?.persistence}
          profileMode={profileMode}
          onChange={(values, nextPersistence) =>
            updateSocial({
              preferred_settings: {
                values,
                persistence: nextPersistence,
              },
            })
          }
        />

        <MultiSelectConstraint
          label="What is the main barrier right now?"
          values={current.barriers?.values ?? []}
          options={SOCIAL_BARRIERS}
          labels={socialBarrierLabels}
          persistence={current.barriers?.persistence}
          profileMode={profileMode}
          onChange={(values, nextPersistence) =>
            updateSocial({
              barriers: {
                values,
                persistence: nextPersistence,
              },
            })
          }
        />

        <TextConstraint
          label="Existing connection surface"
          hint="Examples: coworkers, old friends, neighbors, classmates, online community. No names or private messages."
          value={current.existing_connection_surface?.value}
          persistence={current.existing_connection_surface?.persistence}
          profileMode={profileMode}
          onChange={(value, nextPersistence) =>
            updateSocial({
              existing_connection_surface: {
                value,
                persistence: nextPersistence,
              },
            })
          }
        />

        <TextConstraint
          label="Repeatable contexts available"
          hint="Examples: weekly class, recurring group, volunteer shift, standing call, community event series."
          value={current.repeatable_contexts_available?.value}
          persistence={current.repeatable_contexts_available?.persistence}
          profileMode={profileMode}
          onChange={(value, nextPersistence) =>
            updateSocial({
              repeatable_contexts_available: {
                value,
                persistence: nextPersistence,
              },
            })
          }
        />

        <div className="grid gap-4">
          <SelectField
            label="Safe people to contact"
            value={current.safe_people_to_contact?.value ?? ""}
            onChange={(value) =>
              updateSocial({
                safe_people_to_contact: {
                  ...current.safe_people_to_contact,
                  value: value as SafePeopleToContact,
                  persistence: persistence(
                    current.safe_people_to_contact?.persistence,
                  ),
                },
              })
            }
            options={SAFE_PEOPLE_TO_CONTACT_OPTIONS}
            labels={safePeopleLabels}
          />
          <Field
            label="Optional safe-contact notes"
            hint="Keep this broad. Do not include names, private messages, or other people's identifying details."
          >
            <TextArea
              value={current.safe_people_to_contact?.notes ?? ""}
              onChange={(event) =>
                updateSocial({
                  safe_people_to_contact: {
                    ...current.safe_people_to_contact,
                    notes: event.target.value,
                    persistence: persistence(
                      current.safe_people_to_contact?.persistence,
                    ),
                  },
                })
              }
            />
          </Field>
          <PersistenceField
            value={current.safe_people_to_contact?.persistence}
            profileMode={profileMode}
            onChange={(nextPersistence) =>
              updateSocial({
                safe_people_to_contact: {
                  ...current.safe_people_to_contact,
                  persistence: nextPersistence,
                },
              })
            }
          />
        </div>

        <SelectField
          label="Dating intention"
          value={current.dating_intention?.value ?? ""}
          onChange={(value) =>
            updateSocial({
              dating_intention: {
                value: value as DatingIntention,
                persistence: persistence(current.dating_intention?.persistence),
              },
            })
          }
          options={DATING_INTENTIONS}
          labels={datingIntentionLabels}
        />
        <PersistenceField
          value={current.dating_intention?.persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) =>
            updateSocial({
              dating_intention: {
                ...current.dating_intention,
                persistence: nextPersistence,
              },
            })
          }
        />

        <MultiSelectConstraint
          label="Dating environment"
          values={current.dating_environment?.values ?? []}
          options={DATING_ENVIRONMENTS}
          labels={datingEnvironmentLabels}
          persistence={current.dating_environment?.persistence}
          profileMode={profileMode}
          onChange={(values, nextPersistence) =>
            updateSocial({
              dating_environment: {
                values,
                persistence: nextPersistence,
              },
            })
          }
        />

        <TextConstraint
          label="Broad partner or attraction preferences"
          hint="Use broad preferences only. Do not include explicit sexual details, sexual history, or identifying information."
          value={current.attraction_or_partner_preferences?.value}
          persistence={current.attraction_or_partner_preferences?.persistence}
          profileMode={profileMode}
          onChange={(value, nextPersistence) =>
            updateSocial({
              attraction_or_partner_preferences: {
                value,
                persistence: nextPersistence,
              },
            })
          }
        />

        <TextConstraint
          label="Contexts to avoid"
          hint="Examples: alcohol-centered settings, dating apps, unsafe venues, high-pressure situations."
          value={current.avoid_contexts?.value}
          persistence={current.avoid_contexts?.persistence}
          profileMode={profileMode}
          onChange={(value, nextPersistence) =>
            updateSocial({
              avoid_contexts: {
                value,
                persistence: nextPersistence,
              },
            })
          }
        />

        {!profileMode ? (
          <>
            <Field
              label="Consent and safety constraints"
              hint="Examples: public first meetings, slower pacing, clearer consent communication, avoid alcohol-centered dates. No explicit sexual details."
            >
              <TextArea
                value={current.consent_and_safety_constraints?.value ?? ""}
                onChange={(event) =>
                  updateSocial({
                    consent_and_safety_constraints: {
                      value: event.target.value,
                      persistence: "session_only",
                    },
                  })
                }
              />
            </Field>
            <SelectField
              label="Crisis or immediate safety risk"
              value={current.crisis_or_immediate_safety_risk?.value ?? ""}
              onChange={(value) =>
                updateSocial({
                  crisis_or_immediate_safety_risk: {
                    value: value as SocialCrisisRisk,
                    persistence: "session_only",
                  },
                })
              }
              options={SOCIAL_CRISIS_RISKS}
              labels={socialCrisisLabels}
            />
          </>
        ) : null}
      </div>
    );
  }

  const textCategory = category as Exclude<
    ConstraintCategory,
    | "financial_context"
    | "location"
    | "age_range"
    | "life_stage"
    | "education_or_credentials"
    | "domain_access"
    | "safety_or_emergency_risk"
    | "social_connection"
  >;
  const current = (constraints[textCategory] ?? {}) as {
    value?: string;
    persistence?: MemoryPersistence;
  };

  return (
    <TextConstraint
      label="Broad constraint"
      value={current.value}
      persistence={current.persistence}
      profileMode={profileMode}
      onChange={(value, nextPersistence) =>
        updateCategory(textCategory, {
          value,
          persistence: nextPersistence,
        } as never)
      }
    />
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <SelectInput value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose...</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}

function MultiSelectConstraint<T extends string>({
  label,
  values,
  options,
  labels,
  persistence,
  profileMode = false,
  onChange,
}: {
  label: string;
  values: T[];
  options: readonly T[];
  labels: Record<T, string>;
  persistence?: MemoryPersistence;
  profileMode?: boolean;
  onChange: (values: T[], persistence: MemoryPersistence) => void;
}) {
  const currentPersistence = profileMode
    ? "save_broad_constraint"
    : persistence ?? "session_only";

  return (
    <div className="grid gap-3">
      <div>
        <div className="mb-2 text-sm font-medium text-slate-200">{label}</div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const selected = values.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  const nextValues = selected
                    ? values.filter((value) => value !== option)
                    : [...values, option];
                  onChange(nextValues, currentPersistence);
                }}
                className={`rounded-md border px-2 py-1 text-xs ${
                  selected
                    ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                {labels[option]}
              </button>
            );
          })}
        </div>
      </div>
      {persistence !== undefined || profileMode ? (
        <PersistenceField
          value={persistence}
          profileMode={profileMode}
          onChange={(nextPersistence) => onChange(values, nextPersistence)}
        />
      ) : null}
    </div>
  );
}

function TextConstraint({
  label,
  value,
  hint,
  persistence,
  profileMode,
  onChange,
}: {
  label: string;
  value?: string;
  hint?: string;
  persistence?: MemoryPersistence;
  profileMode: boolean;
  onChange: (value: string, persistence: MemoryPersistence) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label={label} hint={hint}>
        <TextArea
          value={value ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value,
              profileMode ? "save_broad_constraint" : persistence ?? "session_only",
            )
          }
        />
      </Field>
      <PersistenceField
        value={persistence}
        profileMode={profileMode}
        onChange={(nextPersistence) => onChange(value ?? "", nextPersistence)}
      />
    </div>
  );
}

function PersistenceField({
  value,
  profileMode,
  onChange,
}: {
  value?: MemoryPersistence;
  profileMode: boolean;
  onChange: (value: MemoryPersistence) => void;
}) {
  if (profileMode) {
    return (
      <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
        Saved as a broad profile constraint.
      </div>
    );
  }

  const current = value ?? "session_only";
  return (
    <div className="grid gap-2 text-sm text-slate-200">
      <div className="font-medium">Memory</div>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={current === "session_only"}
          onChange={() => onChange("session_only")}
        />
        <span>Use only for this plan</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={current === "save_broad_constraint"}
          onChange={() => onChange("save_broad_constraint")}
        />
        <span>Save broad constraint to profile</span>
      </label>
    </div>
  );
}
