import type { Question, QualityFlag } from "@notebattle/protocol";

/**
 * Deterministic quality gate. Runs on every generated question, LLM or offline,
 * with zero extra model calls. Hard failures reject; soft issues become flags the
 * host sees on the review screen.
 */

export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[^\p{L}\p{N}'"%.+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (text: string) => normalise(text).split(" ").filter(Boolean);

/**
 * Is `evidence` really in `source`? Exact match after normalisation, otherwise at least
 * 90% of the evidence's words must be covered by 4-word sequences that appear verbatim
 * in the source. That tolerates a dropped word or PDF hyphenation, but a paraphrase or
 * an invented "quote" shares almost no 4-grams with the notes and fails.
 */
export function evidenceSupported(evidence: string, source: string): boolean {
  const ev = normalise(evidence);
  if (ev.length < 12) return false;
  const src = normalise(source);
  if (src.includes(ev)) return true;
  const evTok = ev.split(" ");
  const N = 4;
  if (evTok.length < 6) return false; // short quotes must match exactly
  const srcText = ` ${src} `;
  const covered = new Array<boolean>(evTok.length).fill(false);
  for (let i = 0; i + N <= evTok.length; i++) {
    if (srcText.includes(` ${evTok.slice(i, i + N).join(" ")} `)) covered.fill(true, i, i + N);
  }
  return covered.filter(Boolean).length / evTok.length >= 0.9;
}

const BANNED_CHOICE = /^(all|none|both) (of the )?(above|these|of these)$|^(a|b) and (b|c)$/;

export type Verdict = { ok: true; flags: QualityFlag[] } | { ok: false; reason: string };

export function checkQuestion(q: Question, source: string): Verdict {
  const choices = q.choices.map(normalise);
  if (new Set(choices).size !== choices.length) return { ok: false, reason: "duplicate choices" };
  if (choices.some((c) => BANNED_CHOICE.test(c))) return { ok: false, reason: '"all/none of the above" choice' };
  if (!q.evidence) return { ok: false, reason: "no evidence quote" };
  if (!evidenceSupported(q.evidence, source)) return { ok: false, reason: "evidence quote not found in your notes" };
  if (normalise(q.prompt).includes(choices[q.answer]!) && choices[q.answer]!.length > 3)
    return { ok: false, reason: "prompt gives away the answer" };

  const flags: QualityFlag[] = [];
  const lens = q.choices.map((c) => c.length);
  const others = lens.filter((_, i) => i !== q.answer);
  const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
  if (lens[q.answer]! > avgOther * 1.6 && lens[q.answer]! - avgOther > 12) flags.push("answer-longest");
  if (q.evidence.length < 30) flags.push("short-evidence");
  if (maxPairSimilarity(choices) >= 0.8) flags.push("similar-choices");
  if (/\b(NOT|EXCEPT|FALSE)\b/.test(q.prompt)) flags.push("negative-prompt");
  return { ok: true, flags };
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function maxPairSimilarity(choices: string[]): number {
  let max = 0;
  for (let i = 0; i < choices.length; i++)
    for (let j = i + 1; j < choices.length; j++) {
      const a = choices[i]!;
      const b = choices[j]!;
      if (a.split(" ").length < 3 || b.split(" ").length < 3) continue; // short terms are naturally distinct
      max = Math.max(max, jaccard(a, b));
    }
  return max;
}

/** Near-duplicate prompts (same fact asked twice) are dropped; first one wins. */
export function isDuplicatePrompt(prompt: string, kept: readonly Question[]): boolean {
  return kept.some((k) => jaccard(k.prompt, prompt) >= 0.7);
}
