import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 4100;
const WEB_PORT = 3100;

/**
 * Default: full stack locally, $0 (game server in offline mode, in-memory DB, + Next.js).
 * E2E_BASE_URL=https://notebattle.vercel.app runs the same battle against a live deployment.
 */
const live = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 360_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: live ?? `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: live ? [] : [
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
