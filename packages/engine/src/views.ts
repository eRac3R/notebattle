import type { LiveQuestion, PublicPlayer, RevealInfo, RoomView, TopicStat } from "@notebattle/protocol";
import { standings, type GameState, type PlayerState } from "./game.js";

/**
 * Projections from authoritative state to what a client may see.
 *
 * Security rule: while a question is open, no view may reveal anything that depends on
 * whether an answer was correct: not the answer itself, not the evidence, and not the
 * score/streak/rank changes it causes (otherwise players read the scoreboard to learn
 * who got it right). Tests enforce this by diffing views of correct vs. wrong answers.
 */

const hidingOpenQuestion = (s: GameState) => s.phase === "question";

function visibleScore(s: GameState, p: PlayerState): number {
  if (!hidingOpenQuestion(s)) return p.score;
  return p.score - (p.answers[s.index]?.points ?? 0);
}

function visibleStreak(s: GameState, p: PlayerState): number {
  if (!hidingOpenQuestion(s)) return p.streak;
  return p.answers[s.index]?.prevStreak ?? p.streak;
}

function publicPlayers(s: GameState): PublicPlayer[] {
  return standings(s, (p) => visibleScore(s, p)).map(({ player: p, score }) => ({
    id: p.id,
    name: p.name,
    score,
    streak: visibleStreak(s, p),
    connected: p.connected,
    answered: s.phase === "question" && p.answers[s.index] !== undefined,
  }));
}

function liveQuestion(s: GameState): LiveQuestion | null {
  if (s.phase === "lobby" || s.phase === "finished") return null;
  const q = s.questions[s.index]!;
  return {
    index: s.index,
    total: s.questions.length,
    prompt: q.prompt,
    choices: [...q.choices],
    topic: q.topic,
    timeLimitSec: q.timeLimitSec,
    deadline: s.deadline,
  };
}

function revealInfo(s: GameState): RevealInfo | null {
  if (s.phase !== "reveal" && s.phase !== "leaderboard") return null;
  const q = s.questions[s.index]!;
  const distribution = q.choices.map(() => 0);
  for (const p of s.players) {
    const a = p.answers[s.index];
    if (a) distribution[a.choice] = (distribution[a.choice] ?? 0) + 1;
  }
  return { answer: q.answer, explanation: q.explanation, evidence: q.evidence, sourceRef: q.sourceRef, distribution };
}

/** Per-topic accuracy over the questions played so far, weakest first. A skipped question counts as a miss. */
export function topicStats(s: GameState): TopicStat[] {
  const by = new Map<string, { correct: number; attempts: number }>();
  s.questions.forEach((q, i) => {
    if (i > s.index) return;
    const t = by.get(q.topic) ?? { correct: 0, attempts: 0 };
    for (const p of s.players) {
      t.attempts += 1;
      if (p.answers[i]?.correct) t.correct += 1;
    }
    by.set(q.topic, t);
  });
  return [...by.entries()]
    .map(([topic, t]) => ({ topic, ...t, accuracy: t.attempts ? t.correct / t.attempts : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || a.topic.localeCompare(b.topic));
}

function baseView(s: GameState, now: number): RoomView {
  const open = s.phase !== "lobby" && s.phase !== "finished";
  return {
    code: s.code,
    title: s.title,
    phase: s.phase,
    players: publicPlayers(s),
    question: liveQuestion(s),
    reveal: revealInfo(s),
    answeredCount: open ? s.players.filter((p) => p.answers[s.index]).length : 0,
    me: null,
    topics: s.phase === "finished" ? topicStats(s) : null,
    serverNow: now,
  };
}

/** The host screen is usually projected for everyone, so it gets exactly the public view. */
export function hostView(s: GameState, now: number): RoomView {
  return baseView(s, now);
}

export function playerView(s: GameState, playerId: string, now: number): RoomView {
  const view = baseView(s, now);
  const ranked = standings(s, (p) => visibleScore(s, p)).find((r) => r.player.id === playerId);
  if (!ranked) return view;
  const p = ranked.player;
  const a = s.index >= 0 ? p.answers[s.index] : undefined;
  const hidden = hidingOpenQuestion(s);
  view.me = {
    id: p.id,
    name: p.name,
    score: ranked.score,
    streak: visibleStreak(s, p),
    rank: ranked.rank,
    choice: a?.choice ?? null,
    correct: hidden ? false : (a?.correct ?? false),
    points: hidden ? 0 : (a?.points ?? 0),
  };
  return view;
}
