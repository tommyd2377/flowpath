import { DEFAULT_APP_TIMEZONE } from "./env";

export function todayIsoDate() {
  const timezone = process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function nowIso() {
  return new Date().toISOString();
}
