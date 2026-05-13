export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response
    .json()
    .catch(() => ({ error: "The server returned an empty response." }));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload.data as T;
}
