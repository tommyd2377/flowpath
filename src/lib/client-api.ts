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

  const payload = await response
    .json()
    .catch(() => ({ error: "The server returned an empty response." }));

  if (!response.ok) {
    throw new ApiClientError(
      payload.error || "Request failed.",
      response.status,
      payload.code,
      payload.details,
      payload.issues,
    );
  }

  return payload.data as T;
}
