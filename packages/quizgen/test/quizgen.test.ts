import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { QuestionSchema, type GenerationEvent, type Question } from "@notebattle/protocol";
import {
  OpenAICompatClient,
  checkQuestion,
  chunkPages,
  coerceRaw,
  evidenceSupported,
  extractPages,
  generateDeck,
  llmFromEnv,
  offlineQuestions,
  parseJsonObject,
  type ChatClient,
  type ChatMessage,
} from "../src/index.js";

const notes = readFileSync(new URL("../../../samples/os-notes.md", import.meta.url), "utf8");
const bytes = (s: string) => new TextEncoder().encode(s);

async function collect(gen: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function makePdf(paragraphs: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const para of paragraphs) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    let line = "";
    for (const word of para.split(" ")) {
      if (font.widthOfTextAtSize(`${line} ${word}`, 11) > 500) {
        page.drawText(line, { x: 40, y, size: 11, font });
        y -= 16;
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    page.drawText(line, { x: 40, y, size: 11, font });
  }
  return doc.save();
}

describe("extraction + chunking", () => {
  it("reads markdown and keeps headings as topics", async () => {
    const chunks = chunkPages(await extractPages(bytes(notes)));
    const headings = new Set(chunks.map((c) => c.heading));
    expect(headings).toEqual(new Set(["Process Scheduling", "Deadlocks", "Memory Management", "Synchronization", "File Systems"]));
    expect(chunks.every((c) => c.text.length <= 1600)).toBe(true);
  });

  it("reads a real PDF page by page", async () => {
    const paras = notes.split(/\n\n/).filter((p) => !p.startsWith("#"));
    const pages = await extractPages(await makePdf(paras.slice(0, 3)));
    expect(pages).toHaveLength(3);
    expect(pages[2]!.text).toContain("Paging splits physical memory");
    expect(chunkPages(pages).map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it("rejects binary junk and empty files with a friendly error", async () => {
    await expect(extractPages(new Uint8Array([1, 0, 2, 0]))).rejects.toThrow(/Unsupported file/);
    await expect(extractPages(new Uint8Array())).rejects.toThrow(/empty/);
    await expect(extractPages(bytes("%PDF-1.7 broken"))).rejects.toThrow(/Could not read/);
  });
});

describe("evidence verification (anti-hallucination gate)", () => {
  const source = "The TLB is a small, fast cache that stores recent page table entries so most translations skip the memory lookup.";

  it("accepts exact quotes despite case, curly quotes and spacing", () => {
    expect(evidenceSupported("the TLB is a small,  fast cache that stores recent page table entries", source)).toBe(true);
  });

  it("tolerates one dropped word", () => {
    expect(evidenceSupported("The TLB is a small fast cache that stores page table entries so most translations skip the memory lookup", source)).toBe(true);
  });

  it("rejects fabricated or paraphrased evidence", () => {
    expect(evidenceSupported("The TLB is stored on disk and holds file names", source)).toBe(false);
    expect(evidenceSupported("A translation buffer keeps recently used mappings handy", source)).toBe(false);
    expect(evidenceSupported("TLB", source)).toBe(false);
  });
});

const good: Question = QuestionSchema.parse({
  id: "g1",
  prompt: "What does the TLB store?",
  choices: ["Recent page table entries", "Recently used file names", "Free disk block numbers", "Running process IDs"],
  answer: 0,
  evidence: "The TLB is a small, fast cache that stores recent page table entries",
});

describe("question checks", () => {
  it("passes a grounded question", () => {
    expect(checkQuestion(good, notes)).toEqual({ ok: true, flags: [] });
  });

  it("rejects 'all of the above', duplicates and give-aways", () => {
    expect(checkQuestion({ ...good, choices: ["A thing", "B thing", "C thing", "All of the above"] }, notes).ok).toBe(false);
    expect(checkQuestion({ ...good, choices: ["x", "X", "y", "z"] }, notes).ok).toBe(false);
    expect(checkQuestion({ ...good, prompt: "Recent page table entries are stored where?", answer: 0 }, notes).ok).toBe(false);
  });

  it("flags an answer that is suspiciously longer than the distractors", () => {
    const q = { ...good, choices: ["Recent page table entries for faster address translation", "File names", "Disk blocks", "PIDs"] };
    const v = checkQuestion(q, notes);
    expect(v.ok && v.flags).toContain("answer-longest");
  });
});

describe("offline generator", () => {
  it("makes grounded questions spread over every section", async () => {
    const events = await collect(generateDeck(bytes(notes), { llm: null, count: 12 }));
    const qs = events.flatMap((e) => (e.type === "question" ? [e.question] : []));
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: "done", mode: "offline", kept: 12 });
    expect(new Set(qs.map((q) => q.topic)).size).toBe(5);
    for (const q of qs) {
      expect(q.prompt).toContain("_____");
      expect(evidenceSupported(q.evidence, notes)).toBe(true);
      expect(new Set(q.choices).size).toBe(4);
    }
  });

  it("is deterministic", async () => {
    const chunks = chunkPages(await extractPages(bytes(notes)));
    expect(offlineQuestions(chunks, 8)).toEqual(offlineQuestions(chunks, 8));
  });
});

/** Fake provider: answers generation calls with `gen`, re-solve calls with `solve`. */
class FakeLLM implements ChatClient {
  readonly label = "fake";
  calls = { gen: 0, solve: 0 };
  constructor(
    private readonly gen: () => string,
    private readonly solve: (userPrompt: string) => string = (u) => JSON.stringify({ answers: keysIn(u) }),
  ) {}
  async chat(messages: ChatMessage[]) {
    const isSolve = messages[0]!.content.startsWith("You check quiz questions");
    const content = isSolve ? (this.calls.solve++, this.solve(messages[1]!.content)) : (this.calls.gen++, this.gen());
    return { content, promptTokens: 1, completionTokens: 1, ms: 1 };
  }
}

/** An honest solver for the fixture below: answers with each question's true key. */
const TRUE_KEYS: Record<string, string> = { starve: "B", inode: "B" };
const keysIn = (u: string) => u.split(/\n\nQ\d+\. /).map((b) => (/starve/.test(b) ? TRUE_KEYS.starve : TRUE_KEYS.inode));

describe("LLM pipeline", () => {
  const reply = JSON.stringify({
    questions: [
      {
        prompt: "Which algorithm can starve long processes?",
        choices: ["A) FCFS", "B) Shortest Job First", "C) Round Robin", "D) Aging"],
        answer: "B",
        explanation: "Short jobs keep jumping the queue.",
        topic: "Scheduling",
        evidence: "SJF can cause starvation because long processes may wait forever while short ones keep arriving.",
      },
      {
        prompt: "What does an inode store?",
        choices: ["The file name", "Metadata and block addresses", "Only the size", "The directory path"],
        answer: 1,
        explanation: "Names live in directories.",
        topic: "File systems",
        evidence: "An inode stores the file name and its owner.", // fabricated -> must be rejected
      },
      {
        prompt: "Which algorithm can starve long-running processes?", // near-duplicate
        choices: ["FCFS", "SJF", "Round Robin", "Aging"],
        answer: 1,
        evidence: "SJF can cause starvation because long processes may wait forever",
      },
    ],
  });

  it("keeps grounded questions, rejects fabricated evidence and duplicates", async () => {
    const llm = new FakeLLM(() => "```json\n" + reply + "\n```");
    const events = await collect(generateDeck(bytes(notes), { llm, count: 1, concurrency: 1 }));
    const kept = events.filter((e) => e.type === "question");
    const rejected = events.filter((e) => e.type === "rejected").map((e) => (e.type === "rejected" ? e.reason : ""));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ question: { answer: 1, choices: ["FCFS", "Shortest Job First", "Round Robin", "Aging"] } });
    expect(rejected).toContain("evidence quote not found in your notes");
    expect(events.at(-1)).toMatchObject({ type: "done", mode: "llm", kept: 1 });
  });

  it("rejects a question whose answer key the independent re-solve disagrees with", async () => {
    const llm = new FakeLLM(
      () => reply,
      (u) => JSON.stringify({ answers: keysIn(u).map(() => "C") }), // solver picks C; keys say B
    );
    const events = await collect(generateDeck(bytes(notes), { llm, count: 3, concurrency: 1 }));
    expect(events.filter((e) => e.type === "question")).toHaveLength(0);
    expect(events.some((e) => e.type === "rejected" && e.reason === "independent re-solve disagreed with the answer key")).toBe(true);
  });

  it("keeps questions but flags them 'unverified' when the verifier reply is unusable", async () => {
    const llm = new FakeLLM(() => reply, () => "no json here");
    const events = await collect(generateDeck(bytes(notes), { llm, count: 1, concurrency: 1 }));
    const q = events.find((e) => e.type === "question");
    expect(q && q.type === "question" && q.flags).toContain("unverified");
  });

  it("can skip the re-solve to save calls", async () => {
    const llm = new FakeLLM(() => reply);
    await collect(generateDeck(bytes(notes), { llm, count: 1, concurrency: 1, verify: false }));
    expect(llm.calls.solve).toBe(0);
  });

  it("falls back to the offline generator when every LLM call fails", async () => {
    const llm: ChatClient = { label: "down", chat: async () => Promise.reject(new Error("503")) };
    const events = await collect(generateDeck(bytes(notes), { llm, count: 5 }));
    expect(events.at(-1)).toMatchObject({ type: "done", mode: "offline", kept: 5 });
  });

  it("coerces letter answers and strips option prefixes", () => {
    const chunk = { id: "c1", page: 2, heading: "X", text: "" };
    const q = coerceRaw({ prompt: "Pick one of these?", choices: ["A) one", "B) two", "C) three", "D) four"], answer: "c" }, chunk, 0);
    expect(q).toMatchObject({ answer: 2, choices: ["one", "two", "three", "four"], sourceRef: "page 2" });
  });

  it("parses JSON wrapped in chatter", () => {
    expect(parseJsonObject('Sure! Here you go: {"questions": []} hope it helps')).toEqual({ questions: [] });
  });
});

describe("OpenAI-compatible client", () => {
  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    const seen: number[] = [];
    const fetchFn = (async () => {
      seen.push(Date.now());
      if (seen.length === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0.05" } });
      return Response.json({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    }) as typeof fetch;
    const client = new OpenAICompatClient({ baseUrl: "http://x/v1/", model: "m" }, fetchFn);
    const res = await client.chat([{ role: "user", content: "hi" }]);
    expect(res).toMatchObject({ content: "{}", promptTokens: 10 });
    expect(seen).toHaveLength(2);
  });

  it("does not leak the provider's error body", async () => {
    const fetchFn = (async () => new Response("secret-ish details", { status: 401 })) as typeof fetch;
    const client = new OpenAICompatClient({ baseUrl: "http://x/v1", model: "m", maxRetries: 0 }, fetchFn);
    await expect(client.chat([])).rejects.toThrow("LLM provider returned HTTP 401");
  });

  it("env config: hosted providers need a key, local ones don't", () => {
    expect(llmFromEnv({ NOTEBATTLE_LLM_BASE_URL: "https://api.groq.com/openai/v1", NOTEBATTLE_LLM_MODEL: "m" })).toBeNull();
    expect(llmFromEnv({ NOTEBATTLE_LLM_BASE_URL: "http://localhost:11434/v1", NOTEBATTLE_LLM_MODEL: "m" })).not.toBeNull();
    expect(llmFromEnv({ NOTEBATTLE_LLM_BASE_URL: "http://localhost:11434/v1", NOTEBATTLE_LLM_MODEL: "m", NOTEBATTLE_LLM_MODE: "offline" })).toBeNull();
  });
});
