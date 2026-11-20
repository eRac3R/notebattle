import { MAX_PLAYERS, type Deck, type GameSettings, type Phase, type Question } from "@notebattle/protocol";
import { seededRng, shuffledOrder } from "./rng.js";
import { LATENCY_GRACE_MS, pointsFor } from "./scoring.js";

export interface AnswerRecord {
  choice: number;
  /** ms after the question opened */
  elapsedMs: number;
  correct: boolean;
  points: number;
  /** Streak before this answer, so views can hide the change until the reveal. */
  prevStreak: number;
}

export interface PlayerState {
  id: string;
  name: string;
  score: number;
  streak: number;
  bestStreak: number;
  connected: boolean;
  joinOrder: number;
  /** keyed by question index */
  answers: Record<number, AnswerRecord>;
}

export interface GameState {
  code: string;
  title: string;
  settings: GameSettings;
  /** Choices already shuffled for this game; `answer` remapped accordingly. */
  questions: Question[];
  phase: Phase;
  index: number;
  openedAt: number;
  deadline: number;
  players: PlayerState[];
  kicked: string[];
  joinCounter: number;
  /** Bumped on every successful command; lets the server drop stale timers. */
  version: number;
}

export type Command =
  | { type: "join"; playerId: string; name: string }
  | { type: "connection"; playerId: string; connected: boolean }
  | { type: "kick"; playerId: string }
  | { type: "start" }
  | { type: "answer"; playerId: string; questionIndex: number; choice: number }
  | { type: "tick" }
  | { type: "next" };

export type Result = { ok: true; state: GameState; changed: boolean } | { ok: false; error: string };

export function createGame(code: string, deck: Deck, settings: GameSettings, seed: number): GameState {
  const rng = seededRng(seed);
  const questions = deck.questions.map((q) => {
    if (!settings.shuffleChoices) return q;
    const order = shuffledOrder(q.choices.length, rng);
    return { ...q, choices: order.map((i) => q.choices[i]!), answer: order.indexOf(q.answer) };
  });
  return {
    code,
    title: deck.title,
    settings,
    questions,
    phase: "lobby",
    index: -1,
    openedAt: 0,
    deadline: 0,
    players: [],
    kicked: [],
    joinCounter: 0,
    version: 0,
  };
}

const fail = (error: string): Result => ({ ok: false, error });
const same = (state: GameState): Result => ({ ok: true, state, changed: false });

/** Pure transition function. Never mutates `prev`. */
export function reduce(prev: GameState, cmd: Command, now: number): Result {
  const s = structuredClone(prev);
  const r = apply(s, cmd, now);
  if (r !== null) return r;
  s.version += 1;
  return { ok: true, state: s, changed: true };
}

/** Mutates the draft; returns a Result to short-circuit, or null for "changed". */
function apply(s: GameState, cmd: Command, now: number): Result | null {
  switch (cmd.type) {
    case "join": {
      if (s.phase === "finished") return fail("This game has ended");
      if (s.kicked.includes(cmd.playerId)) return fail("You were removed from this room");
      if (s.players.some((p) => p.id === cmd.playerId)) return fail("Already joined");
      if (s.players.length >= MAX_PLAYERS) return fail("Room is full");
      const taken = s.players.some((p) => p.name.toLowerCase() === cmd.name.toLowerCase());
      if (taken) return fail("That nickname is taken");
      s.players.push({
        id: cmd.playerId,
        name: cmd.name,
        score: 0,
        streak: 0,
        bestStreak: 0,
        connected: true,
        joinOrder: s.joinCounter++,
        answers: {},
      });
      return null;
    }
    case "connection": {
      const p = s.players.find((x) => x.id === cmd.playerId);
      if (!p) return fail("Unknown player");
      if (p.connected === cmd.connected) return same(s);
      p.connected = cmd.connected;
      // A disconnect can be the last thing the room was waiting on.
      if (s.phase === "question" && allAnswered(s)) closeQuestion(s);
      return null;
    }
    case "kick": {
      const i = s.players.findIndex((x) => x.id === cmd.playerId);
      if (i < 0) return fail("Unknown player");
      s.players.splice(i, 1);
      s.kicked.push(cmd.playerId);
      if (s.phase === "question" && allAnswered(s)) closeQuestion(s);
      return null;
    }
    case "start": {
      if (s.phase !== "lobby") return fail("Game already started");
      if (s.players.length === 0) return fail("Wait for at least one player");
      openQuestion(s, 0, now);
      return null;
    }
    case "answer": {
      if (s.phase !== "question") return fail("No question is open");
      if (cmd.questionIndex !== s.index) return fail("That question is closed");
      if (now > s.deadline + LATENCY_GRACE_MS) return fail("Time is up");
      const p = s.players.find((x) => x.id === cmd.playerId);
      if (!p) return fail("Unknown player");
      if (p.answers[s.index]) return fail("Already answered");
      const q = s.questions[s.index]!;
      if (cmd.choice < 0 || cmd.choice >= q.choices.length) return fail("Invalid choice");
      const correct = cmd.choice === q.answer;
      const elapsedMs = Math.max(0, now - s.openedAt);
      const streak = correct ? p.streak + 1 : 0;
      const points = pointsFor(correct, elapsedMs, q.timeLimitSec * 1000, streak);
      p.answers[s.index] = { choice: cmd.choice, elapsedMs, correct, points, prevStreak: p.streak };
      p.streak = streak;
      p.bestStreak = Math.max(p.bestStreak, streak);
      p.score += points;
      if (allAnswered(s)) closeQuestion(s);
      return null;
    }
    case "tick": {
      if (s.phase === "question" && now >= s.deadline) {
        closeQuestion(s);
        return null;
      }
      return same(s);
    }
    case "next": {
      if (s.phase === "reveal") {
        s.phase = "leaderboard";
        return null;
      }
      if (s.phase === "leaderboard") {
        if (s.index + 1 >= s.questions.length) s.phase = "finished";
        else openQuestion(s, s.index + 1, now);
        return null;
      }
      return fail(`Cannot advance from ${s.phase}`);
    }
  }
}

function openQuestion(s: GameState, index: number, now: number): void {
  s.phase = "question";
  s.index = index;
  s.openedAt = now;
  s.deadline = now + s.questions[index]!.timeLimitSec * 1000;
}

function allAnswered(s: GameState): boolean {
  const live = s.players.filter((p) => p.connected);
  return live.length > 0 && live.every((p) => p.answers[s.index] !== undefined);
}

function closeQuestion(s: GameState): void {
  s.phase = "reveal";
  for (const p of s.players) if (!p.answers[s.index]) p.streak = 0; // silence breaks a streak
}

/** Competition ranking (1,2,2,4): equal scores share a rank; list order falls back to join order. */
export function standings(
  s: GameState,
  scoreOf: (p: PlayerState) => number = (p) => p.score,
): Array<{ player: PlayerState; rank: number; score: number }> {
  const scored = s.players.map((player) => ({ player, score: scoreOf(player) }));
  scored.sort((a, b) => b.score - a.score || a.player.joinOrder - b.player.joinOrder);
  let rank = 0;
  let prevScore = Number.NaN;
  return scored.map(({ player, score }, i) => {
    if (score !== prevScore) rank = i + 1;
    prevScore = score;
    return { player, rank, score };
  });
}

/** True while answers for the current question are still accepted. */
export function questionIsOpen(s: GameState, now: number): boolean {
  return s.phase === "question" && now <= s.deadline + LATENCY_GRACE_MS;
}
