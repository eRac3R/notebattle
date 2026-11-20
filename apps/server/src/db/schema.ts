import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Question, TopicStat } from "@notebattle/protocol";

export const decks = pgTable("decks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  questions: jsonb("questions").$type<Question[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    deckId: uuid("deck_id").references(() => decks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    questionCount: integer("question_count").notNull(),
    topics: jsonb("topics").$type<TopicStat[]>().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("games_finished_at_idx").on(t.finishedAt)],
);

export const gamePlayers = pgTable(
  "game_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    score: integer("score").notNull(),
    rank: integer("rank").notNull(),
    correct: integer("correct").notNull(),
    bestStreak: integer("best_streak").notNull(),
  },
  (t) => [index("game_players_game_idx").on(t.gameId)],
);
