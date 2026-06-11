import type { WebSearchDecision } from "./cognitive-schemas";
import type { WebSearchDecisionReason } from "./types";

export type SanitizedGenerationError = {
  errorCategory: string;
  errorName: string;
  errorCode: string | null;
  errorStatus: number | null;
  errorMessageSanitized: string;
};

function errorRecord(error: unknown) {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

function cleanCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
  return cleaned || null;
}

function errorStatus(value: unknown) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function sanitizeGenerationError(error: unknown): SanitizedGenerationError {
  const record = errorRecord(error);
  const name = error instanceof Error ? error.name : typeof error;
  const code = cleanCode(record.code ?? record.type);
  const status = errorStatus(record.status ?? record.statusCode);
  const rawMessage = error instanceof Error ? error.message : "";

  let errorCategory = "model_or_network_error";
  let errorMessageSanitized = "The generation request failed before a usable result was saved.";

  if (error instanceof SyntaxError) {
    errorCategory = "schema_parse_error";
    errorMessageSanitized = "The generation response could not be parsed.";
  } else if (/empty/i.test(rawMessage)) {
    errorCategory = "empty_response";
    errorMessageSanitized = "The model returned an empty response.";
  } else if (/schema|parse|zod|invalid_type|too_small|too_big/i.test(rawMessage)) {
    errorCategory = "schema_parse_error";
    errorMessageSanitized = "The generation response did not match the expected schema.";
  } else if (/timeout|timed out|aborted/i.test(rawMessage) || code === "timeout") {
    errorCategory = "timeout";
    errorMessageSanitized = "The generation request timed out.";
  } else if (status === 401 || status === 403) {
    errorCategory = "auth_or_permission_error";
    errorMessageSanitized = "The model provider rejected the request credentials or permissions.";
  } else if (status === 402 || status === 429 || code === "rate_limit_exceeded") {
    errorCategory = "rate_or_quota_error";
    errorMessageSanitized = "The model provider rate or quota limit was reached.";
  } else if (status && status >= 500) {
    errorCategory = "provider_server_error";
    errorMessageSanitized = "The model provider returned a server error.";
  }

  return {
    errorCategory,
    errorName: String(name).slice(0, 80),
    errorCode: code,
    errorStatus: status,
    errorMessageSanitized,
  };
}

export function webSearchDecisionReason(
  decision: WebSearchDecision | null | undefined,
  allowWebSearch = true,
): WebSearchDecisionReason {
  if (!allowWebSearch) return "unavailable_for_tier";
  if (!decision) return "not_needed";
  if (decision.blocked_by_policy) return "blocked_by_policy";
  if (!decision.should_use_web_search) return "not_needed";

  const triggers = new Set(decision.triggers);
  if (triggers.has("explicit_user_request")) return "user_requested_current_info";
  if (triggers.has("pricing_or_recommendations")) return "pricing_or_recommendations";
  if (triggers.has("software_docs_may_have_changed")) return "software_docs_may_have_changed";
  if (triggers.has("laws_regulations_policies")) return "high_stakes_factuality";
  if (
    triggers.has("current_or_time_sensitive") ||
    triggers.has("health_factual_caution") ||
    triggers.has("legal_financial_current_guidance")
  ) {
    return "current_facts_needed";
  }
  return "local_resource_needed";
}

export function countWebSearchCalls(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countWebSearchCalls(item), 0);
  }

  const record = value as Record<string, unknown>;
  const self = record.type === "web_search_call" ? 1 : 0;
  const nested = Object.values(record).reduce<number>(
    (total, item) => total + countWebSearchCalls(item),
    0,
  );
  return self + nested;
}
