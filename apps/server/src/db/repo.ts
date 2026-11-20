import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Deck, GameResults } from "@notebattle/protocol";
import * as schema from "./schema.js";

export type NewGame = Omit<GameResults, "id" | "finishedAt"> & { deckId: string | null };

/** Persistence port. Rooms live in memory; only decks and finished games are stored. */
export interface Repo {
  readonly kind: "postgres" | "memory";
  saveDeck(deck: Deck): Promise<string>;
  saveGame(game: NewGame): Promise<string>;
  getResults(id: string): Promise<GameResults | null>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  private readonly games = new Map<string, GameResults>();
  private readonly decks = new Map<string, Deck>();

  async saveDeck(deck: Deck) {
    const id = randomUUID();
    this.decks.set(id, deck);
    return id;
  }
  async saveGame(game: NewGame) {
    const id = randomUUID();
    const { deckId: _deckId, ...rest } = game;
    this.games.set(id, { ...rest, id, finishedAt: new Date().toISOString() });
    if (this.games.size > 500) this.games.delete(this.games.keys().next().value!);
    return id;
  }
  async getResults(id: string) {
    return this.games.get(id) ?? null;
  }
  async ping() {
    return true;
  }
  async close() {}
}

export class PgRepo implements Repo {
  readonly kind = "postgres" as const;
  private readonly sql: postgres.Sql;
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(url: string) {
    // prepare:false keeps us compatible with PgBouncer transaction pooling (Neon pooled URLs).
    this.sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 15 });
    this.db = drizzle(this.sql, { schema });
  }

  async saveDeck(deck: Deck) {
    const [row] = await this.db.insert(schema.decks).values({ title: deck.title, questions: deck.questions }).returning({ id: schema.decks.id });
    return row!.id;
  }

  async saveGame(game: NewGame) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.games)
        .values({ code: game.code, deckId: game.deckId, title: game.title, questionCount: game.questionCount, topics: game.topics })
        .returning({ id: schema.games.id });
      if (game.players.length) await tx.insert(schema.gamePlayers).values(game.players.map((p) => ({ ...p, gameId: row!.id })));
      return row!.id;
    });
  }

  async getResults(id: string): Promise<GameResults | null> {
    if (!UUID_RE.test(id)) return null;
    const game = await this.db.query.games.findFirst({ where: eq(schema.games.id, id) });
    if (!game) return null;
    const players = await this.db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, id))
      .orderBy(asc(schema.gamePlayers.rank));
    return {
      id: game.id,
      code: game.code,
      title: game.title,
      finishedAt: game.finishedAt.toISOString(),
      questionCount: game.questionCount,
      topics: game.topics,
      players: players.map(({ name, score, rank, correct, bestStreak }) => ({ name, score, rank, correct, bestStreak })),
    };
  }

  async ping() {
    try {
      await this.sql`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

export function repoFromEnv(env: Record<string, string | undefined> = process.env): Repo {
  return env.DATABASE_URL ? new PgRepo(env.DATABASE_URL) : new MemoryRepo();
}
