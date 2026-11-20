import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeckSchema } from "@notebattle/protocol";
import { PgRepo } from "../src/db/repo.js";

/** Runs only when TEST_DATABASE_URL points at a disposable Postgres (docker compose / CI service). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgRepo against real Postgres", () => {
  let repo: PgRepo;
  beforeAll(() => {
    execFileSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, NOTEBATTLE_SKIP_DOTENV: "1" },
      stdio: "pipe",
    });
    repo = new PgRepo(url!);
  });
  afterAll(() => repo?.close());

  it("round-trips a deck and a finished game", async () => {
    const deck = DeckSchema.parse({
      title: "PG",
      questions: [{ id: "a", prompt: "Is this stored in Postgres?", choices: ["yes", "no", "maybe", "later"], answer: 0 }],
    });
    const deckId = await repo.saveDeck(deck);
    const id = await repo.saveGame({
      code: "ABCDEF",
      deckId,
      title: "PG",
      questionCount: 1,
      topics: [{ topic: "General", correct: 1, attempts: 2, accuracy: 0.5 }],
      players: [
        { name: "b", score: 0, rank: 2, correct: 0, bestStreak: 0 },
        { name: "a", score: 900, rank: 1, correct: 1, bestStreak: 1 },
      ],
    });
    const res = await repo.getResults(id);
    expect(res?.players.map((p) => p.name)).toEqual(["a", "b"]);
    expect(res?.topics[0]?.accuracy).toBe(0.5);
    expect(await repo.getResults("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await repo.ping()).toBe(true);
  });
});
