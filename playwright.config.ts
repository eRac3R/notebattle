import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 4100;
const WEB_PORT = 3100;

/** Full stack, $0: game server in offline mode (no LLM, in-memory DB) + Next.js. */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @notebattle/server exec tsx src/main.ts",
      url: `http://localhost:${SERVER_PORT}/healthz`,
      env: {
        PORT: String(SERVER_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        NOTEBATTLE_SKIP_DOTENV: "1",
        NOTEBATTLE_LLM_MODE: "offline",
        NODE_ENV: "production",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @notebattle/web exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { NEXT_PUBLIC_SERVER_URL: `http://localhost:${SERVER_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
