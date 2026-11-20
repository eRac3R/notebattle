import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DeckSchema, type Deck } from "@notebattle/protocol";
import {
  createGame,
  hostView,
  playerView,
  pointsFor,
  reduce,
  standings,
  topicStats,
  type Command,
  type GameState,
} from "../src/index.js";

const deck: Deck = DeckSchema.parse({
  title: "OS basics",
  questions: [
    {
      id: "q1",
      prompt: "Which scheduling algorithm can cause starvation?",
      choices: ["Round robin", "Shortest job first", "FCFS", "None of these"],
      answer: 1,
      explanation: "Long jobs may wait forever behind short ones.",
      topic: "Scheduling",
      evidence: "SJF can starve long processes",
      timeLimitSec: 20,
    },
    {
      id: "q2",
      prompt: "What does a TLB cache?",
      choices: ["Page table entries", "Disk blocks", "Instructions", "Sockets"],
      answer: 0,
      topic: "Memory",
      evidence: "The TLB caches recent page table entries",
      timeLimitSec: 10,
    },
  ],
});

const T0 = 1_000_000;

function run(state: GameState, cmd: Command, now = T0): GameState {
  const r = reduce(state, cmd, now);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function lobby(players = ["ann", "bob"], shuffle = false): GameState {
  let s = createGame("ABC123", deck, { shuffleChoices: shuffle, autoAdvanceSec: 0 }, 42);
  for (const name of players) s = run(s, { type: "join", playerId: `p-${name}`, name });
  return s;
}

const answerOf = (s: GameState) => s.questions[s.index]!.answer;

describe("game flow", () => {
  it("plays a full game lobby -> question -> reveal -> leaderboard -> finished", () => {
    let s = lobby();
    s = run(s, { type: "start" });
    expect(s.phase).toBe("question");
    s = run(s, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: answerOf(s) }, T0 + 2000);
    expect(s.phase).toBe("question");
    s = run(s, { type: "answer", playerId: "p-bob", questionIndex: 0, choice: 0 }, T0 + 3000);
    expect(s.phase).toBe("reveal"); // everyone answered -> closes early
    s = run(s, { type: "next" });
    expect(s.phase).toBe("leaderboard");
    s = run(s, { type: "next" }, T0 + 10_000);
    expect(s.phase).toBe("question");
    expect(s.index).toBe(1);
    s = run(s, { type: "tick" }, T0 + 10_000 + 10_000);
    expect(s.phase).toBe("reveal");
    s = run(s, { type: "next" });
    s = run(s, { type: "next" });
    expect(s.phase).toBe("finished");
    const ann = s.players.find((p) => p.id === "p-ann")!;
    expect(ann.score).toBe(pointsFor(true, 2000, 20_000, 1));
    expect(ann.streak).toBe(0); // silent on q2 breaks the streak
  });

  it("never mutates the previous state", () => {
    const s = lobby();
    const snapshot = JSON.stringify(s);
    reduce(s, { type: "start" }, T0);
    reduce(s, { type: "join", playerId: "p-cat", name: "cat" }, T0);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("refuses to start an empty room", () => {
    const r = reduce(lobby([]), { type: "start" }, T0);
    expect(r).toEqual({ ok: false, error: "Wait for at least one player" });
  });

  it("rejects duplicate nicknames case-insensitively", () => {
    const r = reduce(lobby(["Ann"]), { type: "join", playerId: "x", name: "ANN" }, T0);
    expect(r.ok).toBe(false);
  });

  it("lets latecomers join mid-game with zero points", () => {
    let s = run(lobby(), { type: "start" });
    s = run(s, { type: "join", playerId: "p-late", name: "late" });
    expect(s.players.at(-1)!.score).toBe(0);
  });

  it("kicked players cannot rejoin", () => {
    let s = run(lobby(), { type: "kick", playerId: "p-bob" });
    expect(reduce(s, { type: "join", playerId: "p-bob", name: "bob2" }, T0).ok).toBe(false);
    expect(s.players).toHaveLength(1);
  });
});

describe("answer rules (server authority)", () => {
  const started = () => run(lobby(), { type: "start" });

  it("accepts one answer per player per question", () => {
    const s = run(started(), { type: "answer", playerId: "p-ann", questionIndex: 0, choice: 0 }, T0 + 100);
    const again = reduce(s, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: 1 }, T0 + 200);
    expect(again).toEqual({ ok: false, error: "Already answered" });
  });

  it("rejects answers after the deadline plus grace", () => {
    const late = reduce(started(), { type: "answer", playerId: "p-ann", questionIndex: 0, choice: 1 }, T0 + 20_000 + 301);
    expect(late.ok).toBe(false);
    const inGrace = reduce(started(), { type: "answer", playerId: "p-ann", questionIndex: 0, choice: 1 }, T0 + 20_000 + 250);
    expect(inGrace.ok).toBe(true);
  });

  it("rejects answers for a question that is not the open one", () => {
    const r = reduce(started(), { type: "answer", playerId: "p-ann", questionIndex: 1, choice: 0 }, T0);
    expect(r.ok).toBe(false);
  });

  it("closes the question when the last connected player answers or drops", () => {
    let s = run(started(), { type: "answer", playerId: "p-ann", questionIndex: 0, choice: 0 }, T0 + 100);
    s = run(s, { type: "connection", playerId: "p-bob", connected: false }, T0 + 200);
    expect(s.phase).toBe("reveal");
  });

  it("tick before the deadline is a no-op", () => {
    const r = reduce(started(), { type: "tick" }, T0 + 5);
    expect(r.ok && r.changed).toBe(false);
  });
});

describe("scoring", () => {
  it("fast correct answers score more, wrong answers score zero", () => {
    expect(pointsFor(true, 0, 20_000, 1)).toBe(1000);
    expect(pointsFor(true, 20_000, 20_000, 1)).toBe(500);
    expect(pointsFor(false, 0, 20_000, 3)).toBe(0);
  });

  it("caps the streak bonus", () => {
    expect(pointsFor(true, 0, 20_000, 2)).toBe(1100);
    expect(pointsFor(true, 0, 20_000, 50)).toBe(1400);
  });

  it("stays within bounds for any timing", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: -5000, max: 200_000 }), fc.integer({ min: 0, max: 100 }), (c, ms, streak) => {
        const pts = pointsFor(c, ms, 20_000, streak);
        return c ? pts >= 500 && pts <= 1400 : pts === 0;
      }),
    );
  });

  it("uses competition ranking for ties", () => {
    const s = lobby(["a", "b", "c"]);
    s.players[0]!.score = 100;
    s.players[1]!.score = 300;
    s.players[2]!.score = 100;
    expect(standings(s).map((r) => [r.player.name, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
    ]);
  });
});

describe("choice shuffling", () => {
  it("keeps the correct answer text attached to the answer index", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const s = createGame("ABC123", deck, { shuffleChoices: true, autoAdvanceSec: 0 }, seed);
        return s.questions.every((q, i) => q.choices[q.answer] === deck.questions[i]!.choices[deck.questions[i]!.answer]);
      }),
    );
  });
});

describe("anti-cheat views", () => {
  /** Views of everyone else must not change based on whether `p-ann` was right. */
  it("a correct and a wrong answer are indistinguishable until the reveal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 19_000 }), fc.integer({ min: 0, max: 3 }), (ms, wrongOffset) => {
        const base = run(lobby(["ann", "bob", "cat"]), { type: "start" });
        const right = answerOf(base);
        const wrong = (right + 1 + (wrongOffset % 3)) % 4;
        const now = T0 + ms;
        const a = run(base, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: right }, now);
        const b = run(base, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: wrong }, now);
        expect(a.phase).toBe("question");
        expect(hostView(a, now)).toEqual(hostView(b, now));
        expect(playerView(a, "p-bob", now)).toEqual(playerView(b, "p-bob", now));
        const mine = (s: GameState) => ({ ...playerView(s, "p-ann", now).me, choice: null });
        expect(mine(a)).toEqual(mine(b));
      }),
      { numRuns: 200 },
    );
  });

  it("never serialises the answer, explanation or evidence while a question is open", () => {
    let s = run(lobby(), { type: "start" });
    s = run(s, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: answerOf(s) }, T0 + 10);
    for (const v of [hostView(s, T0), playerView(s, "p-ann", T0), playerView(s, "p-bob", T0)]) {
      const json = JSON.stringify(v);
      expect(v.reveal).toBeNull();
      expect(json).not.toContain("starve");
      expect(json).not.toContain("wait forever");
    }
  });

  it("shows the reveal, distribution and personal result after closing", () => {
    let s = run(lobby(), { type: "start" });
    s = run(s, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: answerOf(s) }, T0 + 10);
    s = run(s, { type: "answer", playerId: "p-bob", questionIndex: 0, choice: (answerOf(s) + 1) % 4 }, T0 + 10);
    const v = playerView(s, "p-ann", T0);
    expect(v.reveal?.evidence).toContain("starve");
    expect(v.reveal?.distribution.reduce((x, y) => x + y)).toBe(2);
    expect(v.me).toMatchObject({ correct: true, rank: 1, streak: 1 });
    expect(playerView(s, "p-bob", T0).me).toMatchObject({ correct: false, points: 0, rank: 2 });
  });
});

describe("weak-topic report", () => {
  it("ranks topics weakest first and counts silence as a miss", () => {
    let s = run(lobby(), { type: "start" });
    s = run(s, { type: "answer", playerId: "p-ann", questionIndex: 0, choice: answerOf(s) }, T0);
    s = run(s, { type: "answer", playerId: "p-bob", questionIndex: 0, choice: answerOf(s) }, T0);
    s = run(run(s, { type: "next" }), { type: "next" }, T0);
    s = run(s, { type: "tick" }, T0 + 60_000);
    expect(topicStats(s)).toEqual([
      { topic: "Memory", correct: 0, attempts: 2, accuracy: 0 },
      { topic: "Scheduling", correct: 2, attempts: 2, accuracy: 1 },
    ]);
  });
});
