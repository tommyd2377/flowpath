export const DEFAULT_DATABASE_URL = "file:./data/needle.db";
export const DEFAULT_APP_TIMEZONE = "America/New_York";

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

export function getDatabaseAuthToken() {
  return process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;
}
