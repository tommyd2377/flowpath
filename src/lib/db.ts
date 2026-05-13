import { createClient, type InArgs, type Row, type Value } from "@libsql/client";

import { getDatabaseAuthToken, getDatabaseUrl } from "./env";

const databaseUrl = getDatabaseUrl();

export const db = createClient({
  url: databaseUrl,
  authToken: getDatabaseAuthToken(),
});

function normalizeValue(value: Value) {
  if (typeof value === "bigint") return Number(value);
  return value;
}

function rowToObject<T>(row: Row, columns: string[]): T {
  return Object.fromEntries(
    columns.map((column, index) => [column, normalizeValue(row[index])]),
  ) as T;
}

export async function all<T>(sql: string, args?: InArgs): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => rowToObject<T>(row, result.columns));
}

export async function first<T>(sql: string, args?: InArgs): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args?: InArgs) {
  return db.execute({ sql, args });
}

export async function insert(sql: string, args?: InArgs) {
  const result = await run(sql, args);
  return Number(result.lastInsertRowid);
}
