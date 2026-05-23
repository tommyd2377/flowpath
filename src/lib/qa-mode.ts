export const QA_HEADER = "x-flowpath-qa";
export const QA_STORAGE_KEY = "flowpath.qaMode";

export function isQaRequest(request: Request) {
  const header = request.headers.get(QA_HEADER)?.toLowerCase();
  if (header === "1" || header === "true") return true;
  try {
    return new URL(request.url).searchParams.get("qa") === "true";
  } catch {
    return false;
  }
}

export function readClientQaMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(QA_STORAGE_KEY) === "true";
}

export function writeClientQaMode(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) window.localStorage.setItem(QA_STORAGE_KEY, "true");
  else window.localStorage.removeItem(QA_STORAGE_KEY);
  window.dispatchEvent(new Event("flowpath-qa-mode-change"));
}

export function syncClientQaModeFromUrl() {
  if (typeof window === "undefined") return readClientQaMode();
  const params = new URLSearchParams(window.location.search);
  const value = params.get("qa");
  if (value === "true") writeClientQaMode(true);
  if (value === "false") writeClientQaMode(false);
  return readClientQaMode();
}
