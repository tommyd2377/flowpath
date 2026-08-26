import { loadEnvConfig } from "@next/env";
import { createClient } from "@libsql/client";

import {
  ensureLocalDatabaseDirectory,
  resolveWorldDatabaseUrl,
} from "../src/lib/server/world-database-config";
import { LibsqlWorldRepository } from "../src/lib/server/world-libsql-repository";

loadEnvConfig(process.cwd());

async function main() {
  const url = resolveWorldDatabaseUrl();
  ensureLocalDatabaseDirectory(url);
  const client = createClient({ url });
  await new LibsqlWorldRepository(client).initialize();
  client.close();
  console.log("Possibility Atlas world database is ready.");
}

void main().catch((error: unknown) => {
  console.error("Possibility Atlas database initialization failed.", error);
  process.exitCode = 1;
});
