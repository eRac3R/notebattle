import type { QuestionInput } from "@notebattle/protocol";
import { splitSentences, type Chunk } from "./extract.js";

/**
 * $0, deterministic, no-network question generator: fill-in-the-blank over key terms,
 * with distractors drawn from the *same document* and the same kind of term
 * (acronym <-> acronym, number <-> number...). Weaker than an LLM, but it works on
 * real notes, so offline mode and CI exercise the full pipeline.
 */

type Kind = "acronym" | "proper" | "number" | "term";
interface Term {
  text: string;
  kind: Kind;
}

const STOP = new Set(
  "about above after again against because before being below between could during further having however itself other should there these those through under until where which while would their them then than this that with from into also such only very more most some each when what your yours example examples important following called usually generally another happens happen number numbers external internal different several without something anything everything general simple standard exactly single multiple possible problem problems result results values gives given makes using keeps called means order instead within whether against".split(
    " ",
  ),
);

const ACRONYM = /\b[A-Z]{2,6}s?\b/g;
const PROPER = /\b[A-Z][a-z]+(?:[ -][A-Z][a-z]+)+\b/g;
const NUMBER = /\b\d+(?:\.\d+)?\s?(?:%|ms|ns|KB|MB|GB|TB|bits?|bytes?|years?|hours?|seconds?)?(?![\w.])/g;
const LEADING_FILLER = /^(The|A|An|If|This|That|These|In|On|For|When)\b/;
/** Crude stem so "process"/"processes" never appear side by side as choices. */
const stem = (w: string) => w.toLowerCase().replace(/(es|s)$/, "");
const WORD = /\b[a-z][a-z-]{6,}\b/g;

function termsIn(sentence: string, docTerms: Map<string, Term>): Term[] {
  const found: Term[] = [];
  const add = (text: string, kind: Kind) => {
    const t = text.trim();
    if (!found.some((f) => f.text === t)) found.push({ text: t, kind });
  };
  for (const m of sentence.matchAll(ACRONYM)) add(m[0], "acronym");
  for (const m of sentence.matchAll(PROPER)) if (m.index! > 0 && !LEADING_FILLER.test(m[0])) add(m[0], "proper");
  for (const m of sentence.matchAll(NUMBER)) add(m[0], "number");
  for (const m of sentence.matchAll(WORD)) if (docTerms.has(m[0])) add(m[0], "term");
  return found;
}

/** Document-wide vocabulary, so distractors come from the same notes. */
function collectDocTerms(chunks: Chunk[]): Map<string, Term> {
  const counts = new Map<string, number>();
  const all = new Map<string, Term>();
  const text = chunks.map((c) => c.text).join("\n");
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (!STOP.has(w) && !w.endsWith("ly")) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  for (const [w, n] of counts) if (n >= 2) all.set(w, { text: w, kind: "term" });
  for (const m of text.matchAll(ACRONYM)) all.set(m[0], { text: m[0], kind: "acronym" });
  for (const m of text.matchAll(PROPER)) if (!LEADING_FILLER.test(m[0])) all.set(m[0], { text: m[0], kind: "proper" });
  for (const m of text.matchAll(NUMBER)) all.set(m[0].trim(), { text: m[0].trim(), kind: "number" });
  return all;
}

function numberDistractors(n: string): string[] {
  const m = n.match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return [];
  const v = Number(m[1]);
  const unit = m[2] ?? "";
  const fmt = (x: number) => `${Number.isInteger(v) ? Math.round(x) : x.toFixed(1)}${unit}`;
  return [v * 2, v / 2, v + (v >= 10 ? 10 : 1), v * 10].map(fmt).filter((x) => x !== n && !x.startsWith("0"));
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function offlineQuestions(chunks: Chunk[], count: number): Array<{ question: QuestionInput; chunk: Chunk }> {
  const docTerms = collectDocTerms(chunks);
  const byKind = new Map<Kind, string[]>();
  for (const t of docTerms.values()) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t.text]);

  const out: Array<{ question: QuestionInput; chunk: Chunk }> = [];
  const usedAnswers = new Set<string>();
  // Round-robin over chunks so questions cover the whole document, not just page 1.
  const queues = chunks.map((c) => ({ chunk: c, sentences: splitSentences(c.text).filter((s) => s.length >= 40 && s.length <= 260) }));
  let progressed = true;
  while (out.length < count && progressed) {
    progressed = false;
    for (const q of queues) {
      if (out.length >= count) break;
      const sentence = q.sentences.shift();
      if (!sentence) continue;
      progressed = true;
      const made = blankQuestion(sentence, q.chunk, docTerms, byKind, usedAnswers);
      if (made) {
        usedAnswers.add(made.choices[made.answer]!.toLowerCase());
        out.push({ question: made, chunk: q.chunk });
      }
    }
  }
  return out;
}

function blankQuestion(
  sentence: string,
  chunk: Chunk,
  docTerms: Map<string, Term>,
  byKind: Map<Kind, string[]>,
  usedAnswers: Set<string>,
): (QuestionInput & { choices: string[]; answer: number }) | null {
  const candidates = termsIn(sentence, docTerms)
    .filter((t) => !usedAnswers.has(t.text.toLowerCase()))
    // Prefer named concepts over plain words; numbers last (often incidental).
    .sort((a, b) => rankKind(a.kind) - rankKind(b.kind) || b.text.length - a.text.length);
  for (const term of candidates) {
    const pool = (byKind.get(term.kind) ?? []).filter(
      (x) => x.toLowerCase() !== term.text.toLowerCase() && !sentence.toLowerCase().includes(x.toLowerCase()),
    );
    if (term.kind === "number") pool.push(...numberDistractors(term.text));
    const seen = new Set([stem(term.text)]);
    const unique = pool.filter((x) => {
      const k = stem(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length < 3) continue;
    // Deterministic pick, biased to similar length so the answer doesn't stand out.
    const seed = hash(sentence);
    const distractors = unique
      .map((x, i) => ({ x, d: Math.abs(x.length - term.text.length) + ((seed + i * 7) % 5) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((o) => o.x);
    const answer = seed % 4;
    const choices = [...distractors];
    choices.splice(answer, 0, term.text);
    const blanked = sentence.replace(new RegExp(`(?<![\\w])${escapeRe(term.text)}(?![\\w])`, "g"), "_____");
    if (!blanked.includes("_____")) continue;
    return {
      id: `off-${chunk.id}-${hash(sentence).toString(36)}`,
      prompt: `Fill in the blank: ${blanked}`.slice(0, 300),
      choices,
      answer,
      explanation: `Straight from your notes on ${chunk.heading}.`,
      topic: chunk.heading.slice(0, 60),
      evidence: sentence,
      sourceRef: `page ${chunk.page}`,
      timeLimitSec: 20,
    };
  }
  return null;
}

function rankKind(k: Kind): number {
  return { acronym: 0, proper: 1, term: 2, number: 3 }[k];
}
