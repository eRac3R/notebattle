import { llmFromEnv } from "@notebattle/quizgen";
import { buildApp } from "./app.js";
import { repoFromEnv } from "./db/repo.js";
import { loadDotenv } from "./env.js";

loadDotenv();

const port = Number(process.env.PORT ?? 4000);
const dev = process.env.NODE_ENV !== "production";
// Production: explicit allow-list. Dev: reflect any origin so phones on the LAN can join.
const webOrigins: string[] | true = process.env.WEB_ORIGIN
  ? process.env.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : dev
    ? true
    : ["http://localhost:3000"];

const app = await buildApp({
  repo: repoFromEnv(),
  llm: llmFromEnv(),
  webOrigins,
  logger: dev ? { level: "info", transport: { target: "pino-pretty", options: { singleLine: true } } } : { level: "info" },
});

await app.http.listen({ port, host: "0.0.0.0" });
app.http.log.info({ db: process.env.DATABASE_URL ? "postgres" : "memory", llm: process.env.NOTEBATTLE_LLM_MODEL ?? "offline" }, "NoteBattle server ready");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    app.http.log.info({ sig }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
