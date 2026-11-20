import { loadDotenv } from "../env.js";
import { runMigrations } from "./migrations.js";

loadDotenv();
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set; nothing to migrate (memory mode needs no schema).");
  process.exit(1);
}
await runMigrations(url);
console.log("migrations applied");
