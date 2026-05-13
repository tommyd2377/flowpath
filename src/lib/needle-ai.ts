import OpenAI from "openai";

import { dailyPlanSchema, interviewerOutputSchema, nextMovePlanSchema } from "./schemas";
import type {
  CheckIn,
  DailyPlan,
  IntakeMessage,
  IntakeSession,
  LifeArea,
  NextMovePlan,
  Profile,
  Project,
  Situation,
  StoredNextMovePlan,
  StoredPlan,
  Task,
} from "./types";
import { todayIsoDate } from "./time";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

const systemPrompt = `You are Needle, a practical AI prioritization strategist. Your job is to help the user identify the few actions today that most move their life forward across work, health, creativity, acting, and personal stability. You are direct, grounded, and psychologically perceptive. You do not overwhelm the user. You choose 3 main actions maximum. You distinguish urgent from important. You notice avoidance patterns. You respect health and energy constraints. You optimize for real-world momentum, not fantasy productivity.`;

const interviewerSystemPrompt = `You are Needle's intake interviewer. Your job is to understand the user's current situation well enough to help identify their next best move. Ask one clear question at a time. Focus on goals, constraints, resources, urgency, what has been tried, what is being avoided, and what would create real-world progress. Do not overwhelm the user. Do not give the full plan yet unless the user asks. If the situation appears high-stakes, gather enough information to triage safely and recommend appropriate human help. Your tone is calm, direct, practical, and humane.`;

const strategistSystemPrompt = `You are Needle, a practical AI mentor for people without a mentor. Your job is to identify the user's next best move based on their goals, constraints, resources, current reality, urgency, and risks. You are not a generic productivity coach. You separate leverage from busyness. You do not overwhelm the user. You give realistic, actionable guidance. You are allowed to be direct. You are careful around legal, medical, housing, addiction, mental health, and safety issues, and you clearly recommend appropriate human or professional help when needed. Your output should help the user act in the real world today.`;

const dailyPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "today_theme",
    "honest_read",
    "top_3_actions",
    "avoid_today",
    "optional_if_energy_is_high",
    "minimum_viable_day",
    "evening_review_prompt",
  ],
  properties: {
    today_theme: { type: "string" },
    honest_read: { type: "string" },
    top_3_actions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "area",
          "why_it_matters",
          "estimated_minutes",
          "success_condition",
          "first_step",
        ],
        properties: {
          title: { type: "string" },
          area: { type: "string" },
          why_it_matters: { type: "string" },
          estimated_minutes: { type: "integer", minimum: 1, maximum: 480 },
          success_condition: { type: "string" },
          first_step: { type: "string" },
        },
      },
    },
    avoid_today: { type: "string" },
    optional_if_energy_is_high: { type: "string" },
    minimum_viable_day: { type: "string" },
    evening_review_prompt: { type: "string" },
  },
};

export type NeedleContext = {
  profile: Profile;
  lifeAreas: LifeArea[];
  activeProjects: Project[];
  unfinishedTasks: Task[];
  recentCheckIns: CheckIn[];
  recentPlans: StoredPlan[];
  activeSituations?: Situation[];
  recentNextMovePlans?: StoredNextMovePlan[];
  todayCheckIn: CheckIn | null;
};

export type InterviewerContext = {
  profile: Profile;
  situation: Situation;
  session: IntakeSession;
  messages: IntakeMessage[];
};

export type StrategistContext = {
  profile: Profile;
  situation: Situation;
  session: IntakeSession | null;
  messages: IntakeMessage[];
  openTasks: Task[];
  recentCheckIns: CheckIn[];
  recentPlans: StoredNextMovePlan[];
};

function extractOutputText(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown[] })?.content;
      if (!Array.isArray(content)) return [];
      return content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .filter(Boolean);
    })
    .join("\n");
}

export async function generateNeedlePlan(context: NeedleContext): Promise<{
  plan: DailyPlan;
  model: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            date: todayIsoDate(),
            instruction:
              "Return a daily command briefing. Be specific, realistic, emotionally honest, and willing to say when today is not a huge push day. Pick no more than three actions.",
            context,
          },
          null,
          2,
        ),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "needle_daily_plan",
        description: "A concise daily prioritization plan for Needle.",
        strict: true,
        schema: dailyPlanJsonSchema,
      },
    },
  });

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw new Error("The model returned an empty plan.");
  }

  const parsed = dailyPlanSchema.parse(JSON.parse(outputText));
  return { plan: parsed, model };
}

const interviewerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "question",
    "current_stage",
    "is_complete",
    "summary_so_far",
    "recommended_urgency",
    "recommended_mode",
  ],
  properties: {
    question: { type: "string" },
    current_stage: {
      type: "string",
      enum: [
        "understanding_goals",
        "understanding_constraints",
        "understanding_resources",
        "identifying_bottleneck",
        "ready_to_generate",
      ],
    },
    is_complete: { type: "boolean" },
    summary_so_far: { type: "string" },
    recommended_urgency: {
      type: ["string", "null"],
      enum: ["low", "medium", "high", "crisis", null],
    },
    recommended_mode: {
      type: ["string", "null"],
      enum: ["growth", "stability", "crisis_triage", "maintenance", null],
    },
  },
};

const nextMovePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "situation_summary",
    "core_bottleneck",
    "highest_leverage_move_today",
    "why_this_move",
    "first_30_minutes",
    "next_24_hours",
    "next_7_days",
    "what_not_to_do",
    "likely_trap",
    "resources_to_seek",
    "when_to_get_human_help",
    "confidence_level",
    "assumptions",
    "follow_up_questions_if_any",
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["growth", "stability", "crisis_triage", "maintenance"],
    },
    situation_summary: { type: "string" },
    core_bottleneck: { type: "string" },
    highest_leverage_move_today: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "estimated_minutes", "success_condition"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        estimated_minutes: { type: "integer", minimum: 1, maximum: 480 },
        success_condition: { type: "string" },
      },
    },
    why_this_move: { type: "string" },
    first_30_minutes: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: nextMoveStepJsonSchema(),
    },
    next_24_hours: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: nextMoveStepJsonSchema(),
    },
    next_7_days: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: nextMoveStepJsonSchema(),
    },
    what_not_to_do: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    likely_trap: { type: "string" },
    resources_to_seek: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why"],
        properties: {
          name: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    when_to_get_human_help: { type: "string" },
    confidence_level: { type: "string", enum: ["low", "medium", "high"] },
    assumptions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    follow_up_questions_if_any: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
};

function nextMoveStepJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "details"],
    properties: {
      title: { type: "string" },
      details: { type: "string" },
    },
  };
}

async function createStructuredResponse({
  system,
  user,
  name,
  description,
  schema,
}: {
  system: string;
  user: unknown;
  name: string;
  description: string;
  schema: Record<string, unknown>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user, null, 2) },
    ],
    text: {
      format: {
        type: "json_schema",
        name,
        description,
        strict: true,
        schema,
      },
    },
  });

  const outputText = extractOutputText(response);
  if (!outputText) throw new Error("The model returned an empty response.");
  return { outputText, model };
}

export async function generateInterviewQuestion(context: InterviewerContext) {
  const { outputText, model } = await createStructuredResponse({
    system: interviewerSystemPrompt,
    name: "needle_interviewer_turn",
    description: "One adaptive intake question and current intake progress.",
    schema: interviewerJsonSchema,
    user: {
      instruction:
        "Ask exactly one next question. If enough information has been gathered, mark is_complete true and ask a short final confirmation or transition question.",
      stages: [
        "understanding_goals",
        "understanding_constraints",
        "understanding_resources",
        "identifying_bottleneck",
        "ready_to_generate",
      ],
      situation: context.situation,
      session: context.session,
      messages: context.messages,
      profile: context.profile,
    },
  });

  return {
    output: interviewerOutputSchema.parse(JSON.parse(outputText)),
    model,
  };
}

export async function generateNextMovePlan(context: StrategistContext): Promise<{
  plan: NextMovePlan;
  model: string;
}> {
  const { outputText, model } = await createStructuredResponse({
    system: strategistSystemPrompt,
    name: "needle_next_move_plan",
    description: "A practical next best move plan for a user's current situation.",
    schema: nextMovePlanJsonSchema,
    user: {
      date: todayIsoDate(),
      instruction:
        "Generate a leverage-focused plan the user can act on today. Be careful and practical for high-stakes situations. Do not overclaim certainty.",
      context,
    },
  });

  return {
    plan: nextMovePlanSchema.parse(JSON.parse(outputText)),
    model,
  };
}
