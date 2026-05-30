import { QA_HEADER, readClientQaMode } from "./qa-mode";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
    public issues?: unknown,
  ) {
    super(message);
  }
}

function readRecordValue(value: unknown, key: string) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringifyErrorValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const messages = value
      .map((item) => stringifyErrorValue(item))
      .filter((message): message is string => Boolean(message));
    return messages.length > 0 ? messages.join(" ") : null;
  }
  if (!value || typeof value !== "object") return null;

  const nestedMessage =
    stringifyErrorValue(readRecordValue(value, "message")) ||
    stringifyErrorValue(readRecordValue(value, "error")) ||
    stringifyErrorValue(readRecordValue(value, "details")) ||
    stringifyErrorValue(readRecordValue(value, "detail")) ||
    stringifyErrorValue(readRecordValue(value, "reason"));
  if (nestedMessage) return nestedMessage;

  const keys = Object.keys(value);
  if (keys.length > 0 && keys.every((key) => ["code", "status", "type"].includes(key))) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized === "{}" ? null : serialized;
  } catch {
    return null;
  }
}

export function apiErrorMessage(payload: unknown, fallback = "Request failed.") {
  return stringifyErrorValue(readRecordValue(payload, "error")) ||
    stringifyErrorValue(readRecordValue(payload, "details")) ||
    stringifyErrorValue(readRecordValue(payload, "message")) ||
    stringifyErrorValue(payload) ||
    fallback;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (readClientQaMode()) {
    headers.set(QA_HEADER, "true");
  }

  const response = await fetch(url, {
    cache: init?.cache ?? "no-store",
    credentials: init?.credentials ?? "same-origin",
    ...init,
    headers,
  });

  const payload: unknown = await response
    .json()
    .catch(() => ({ error: "The server returned an empty response." }));

  if (!response.ok) {
    throw new ApiClientError(
      apiErrorMessage(payload),
      response.status,
      readRecordValue(payload, "code")?.toString(),
      readRecordValue(payload, "details"),
      readRecordValue(payload, "issues"),
    );
  }

  return readRecordValue(payload, "data") as T;
}
