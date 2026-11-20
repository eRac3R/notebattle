import type { Question } from "@notebattle/protocol";
import { parseJsonObject, type ChatClient } from "./llm.js";

/**
 * Independent re-solve. The evidence check proves a quote exists; it cannot prove the
 * question's *logic* (a real run produced a genuine quote with an inverted answer key).
 * So a second call answers every question from the evidence alone, without seeing the
 * key. Disagreement => the question is rejected. One batched call per notes section.
 */
const SYSTEM = `You check quiz questions. Answer each one using ONLY its evidence quote, not outside knowledge.
If the evidence does not determine a single answer, use null.
Reply with a single JSON object and nothing else.`;

const LETTERS = "ABCD";

export function verifyPrompt(questions: Question[]): string {
  const blocks = questions.map((q, i) =>
    [`Q${i + 1}. ${q.prompt}`, `Evidence: "${q.evidence}"`, ...q.choices.map((c, j) => `${LETTERS[j]}) ${c}`)].join("\n"),
  );
  return `${blocks.join("\n\n")}

Return: {"answers": [${questions.map(() => '"A"').join(", ")}]} with one letter (or null) per question, in order.`;
}

/** Returns the solver's choice index per question (null = undetermined). Throws if the reply is unusable. */
export async function resolveAnswers(llm: ChatClient, questions: Question[]): Promise<Array<number | null>> {
  if (questions.length === 0) return [];
  const res = await llm.chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: verifyPrompt(questions) },
    ],
    { json: true, temperature: 0 },
  );
  const obj = parseJsonObject(res.content) as { answers?: unknown };
  if (!Array.isArray(obj.answers) || obj.answers.length !== questions.length) throw new Error("verifier returned the wrong number of answers");
  return obj.answers.map((a) => {
    if (typeof a === "number" && a >= 0 && a < 4) return a;
    if (typeof a === "string") {
      const i = LETTERS.indexOf(a.trim().toUpperCase().charAt(0));
      return i >= 0 ? i : null;
    }
    return null;
  });
}
