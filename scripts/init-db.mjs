import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL || "file:./data/needle.db";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;

function ensureLocalDirectory(url) {
  if (!url.startsWith("file:")) return;
  const rawPath = url.slice("file:".length);
  if (!rawPath || rawPath === ":memory:") return;
  const databasePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

function splitStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

ensureLocalDirectory(databaseUrl);

const client = createClient({ url: databaseUrl, authToken });
const migrationsDirectory = path.resolve(process.cwd(), "migrations");
const files = fs
  .readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

try {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const appliedResult = await client.execute("SELECT name FROM schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => String(row.name)));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipped ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
    const statements = splitStatements(sql);
    await client.batch(statements, "write");
    await client.execute({
      sql: "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      args: [file, new Date().toISOString()],
    });
    console.log(`Applied ${file}`);
  }
  console.log(`Database ready at ${databaseUrl}`);
} finally {
  client.close();
}
