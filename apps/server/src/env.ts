import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads `.env.local` then `.env` from the server folder for local dev.
 * Real environment variables always win; set NOTEBATTLE_SKIP_DOTENV=1 to disable (tests do).
 */
export function loadDotenv(dir = process.cwd()): void {
  if (process.env.NOTEBATTLE_SKIP_DOTENV) return;
  for (const name of [".env.local", ".env"]) {
    const file = resolve(dir, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]!] !== undefined) continue;
      process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
