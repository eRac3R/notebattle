import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Finds apps/server/drizzle whether running from src/db (tsx) or the dist bundle. */
function migrationsFolder(): string {
  for (const rel of ["../drizzle", "../../drizzle"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(dir)) return dir;
  }
  throw new Error("drizzle migrations folder not found");
}

/** Applies pending migrations. Use the unpooled URL: PgBouncer and DDL transactions don't mix well. */
export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 20 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: migrationsFolder() });
  } finally {
    await sql.end();
  }
}
