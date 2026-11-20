"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DeckSchema, type GenerationEvent, type QualityFlag, type Question } from "@notebattle/protocol";
import { Button, CHOICE_STYLES, Logo, Panel, Spinner } from "@/components/game";
import { SERVER_URL } from "@/lib/config";
import { request } from "@/lib/socket";
import { saveHostKey } from "@/lib/storage";

type Item = { q: Question; flags: QualityFlag[] };
type Rejected = { reason: string; prompt: string };
type Stage = "upload" | "generating" | "review";

const FLAG_TEXT: Record<QualityFlag, string> = {
  "answer-longest": "Right answer is much longer than the others (a giveaway)",
  "short-evidence": "Evidence quote is very short",
  "similar-choices": "Two choices are very similar",
  "negative-prompt": "Uses NOT/EXCEPT: easy to misread",
  unverified: "Answer key not re-checked (verifier was unavailable)",
};

export default function CreatePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [count, setCount] = useState(10);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [meta, setMeta] = useState<{ pages?: number; chunks?: number; mode?: string; ms?: number; done?: number; total?: number }>({});
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function generate(file: Blob, name: string) {
    setError(null);
    setItems([]);
    setRejected([]);
    setMeta({});
    setStage("generating");
    const form = new FormData();
    form.set("count", String(count));
    if (title.trim()) form.set("title", title.trim());
    form.set("file", file, name);
    try {
      const res = await fetch(`${SERVER_URL}/api/generate`, { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        throw new Error(body.error ?? body.message ?? `Server error ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as GenerationEvent;
          if (ev.type === "parsed") setMeta((m) => ({ ...m, pages: ev.pages, chunks: ev.chunks }));
          if (ev.type === "progress") setMeta((m) => ({ ...m, done: ev.done, total: ev.total }));
          if (ev.type === "question") setItems((xs) => [...xs, { q: ev.question, flags: ev.flags }]);
          if (ev.type === "rejected") setRejected((xs) => [...xs, { reason: ev.reason, prompt: ev.prompt }]);
          if (ev.type === "error") throw new Error(ev.message);
          if (ev.type === "done") {
            finished = true;
            setMeta((m) => ({ ...m, mode: ev.mode, ms: ev.ms }));
            if (!title.trim()) setTitle(ev.title);
          }
        }
      }
      if (!finished) throw new Error("The connection dropped while generating. Try again.");
      setTimeout(() => setStage("review"), 900);
    } catch (e) {
      setError((e as Error).message);
      setStage("upload");
    }
  }

  async function loadSample() {
    const res = await fetch("/operating-systems-notes.md");
    await generate(await res.blob(), "operating-systems-notes.md");
  }

  function update(i: number, patch: Partial<Question>) {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, q: { ...x.q, ...patch } } : x)));
  }

  async function openRoom() {
    setError(null);
    const parsed = DeckSchema.safeParse({ title: title.trim() || "My notes", questions: items.map((x) => x.q) });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const qi = typeof issue.path[1] === "number" ? ` (question ${issue.path[1] + 1})` : "";
      setError(`${issue.message}${qi}`);
      return;
    }
    setOpening(true);
    try {
      const { code, hostKey } = await request("room:create", { deck: parsed.data });
      saveHostKey(code, hostKey);
      router.push(`/host/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setOpening(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8">
      <nav className="flex items-center justify-between">
        <a href="/">
          <Logo />
        </a>
        <ol className="hidden gap-6 text-sm font-semibold sm:flex">
          {(["upload", "generating", "review"] as const).map((s, i) => (
            <li key={s} className={stage === s ? "text-brand" : "text-muted"}>
              {i + 1}. {s === "upload" ? "Notes" : s === "generating" ? "Generate" : "Review"}
            </li>
          ))}
        </ol>
      </nav>

      {error && <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 font-semibold text-bad">{error}</div>}

      {stage === "upload" && (
        <section className="flex flex-col gap-6">
          <h1 className="text-4xl font-extrabold tracking-tight">What are we studying?</h1>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void generate(f, f.name);
            }}
            onClick={() => fileInput.current?.click()}
            className={`grid cursor-pointer place-items-center rounded-3xl border-2 border-dashed p-14 text-center transition ${dragging ? "border-brand bg-brand/10" : "border-line bg-panel/60 hover:border-brand/60"}`}
          >
            <div>
              <div className="text-5xl">📄</div>
              <p className="mt-4 text-xl font-bold">Drop a PDF, .txt or .md here</p>
              <p className="mt-1 text-muted">or click to choose a file · up to 8 MB / 60 pages · text PDFs only (no scans yet)</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void generate(f, f.name);
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div className="flex flex-col gap-2">
              <span id="count-label" className="text-sm font-semibold text-muted">Questions</span>
              <div className="flex gap-2" role="group" aria-labelledby="count-label">
                {[5, 10, 15, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    aria-pressed={count === n}
                    className={`rounded-lg px-4 py-2 font-mono font-bold ${count === n ? "bg-brand text-ink" : "bg-panel-2 text-muted"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex min-w-60 flex-1 flex-col gap-2">
              <span className="text-sm font-semibold text-muted">Title (optional)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                placeholder="e.g. OS — Unit 3"
                className="rounded-lg border border-line bg-ink px-3 py-2 outline-none focus:border-brand"
              />
            </label>
            <Button variant="ghost" onClick={() => void loadSample()}>
              No notes handy? Try sample OS notes
            </Button>
          </div>
        </section>
      )}

      {stage === "generating" && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-extrabold">Writing your questions…</h1>
              {meta.total ? <span className="font-mono text-muted">{meta.done}/{meta.total} sections</span> : <Spinner />}
            </div>
            <AnimatePresence>
              {items.map(({ q }, i) => (
                <motion.div key={q.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                  <Panel className="flex items-start gap-3 p-4">
                    <span className="font-mono text-good">✓</span>
                    <div>
                      <p className="font-semibold">
                        {i + 1}. {q.prompt}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {q.topic} · {q.sourceRef}
                      </p>
                    </div>
                  </Panel>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <QualityGate kept={items.length} rejected={rejected} meta={meta} />
        </section>
      )}

      {stage === "review" && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight">Review before you battle</h1>
              <p className="mt-1 text-muted">
                {items.length} questions · {rejected.length} rejected by the quality gate ·{" "}
                {meta.mode === "llm" ? "AI generated" : "offline generator (no AI key set)"} in {((meta.ms ?? 0) / 1000).toFixed(1)}s. Fix anything that looks off.
              </p>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              aria-label="Deck title"
              className="rounded-lg border border-line bg-ink px-3 py-2 text-lg font-bold outline-none focus:border-brand"
            />
          </div>

          {items.map((item, i) => (
            <QuestionEditor key={item.q.id} n={i + 1} item={item} onChange={(p) => update(i, p)} onDelete={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
          ))}

          <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-panel/95 p-4 backdrop-blur">
            <Button variant="ghost" onClick={() => setStage("upload")}>
              ← Start over
            </Button>
            <Button onClick={() => void openRoom()} disabled={opening || items.length === 0} className="text-lg">
              {opening ? "Opening…" : `Open room with ${items.length} questions →`}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}

function QualityGate({ kept, rejected, meta }: { kept: number; rejected: Rejected[]; meta: { pages?: number; chunks?: number } }) {
  return (
    <Panel className="h-fit p-5 lg:sticky lg:top-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted">Quality gate</h2>
      <p className="mt-1 text-sm text-muted">
        {meta.pages ?? "…"} pages · {meta.chunks ?? "…"} sections read
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-good/10 p-3">
          <div className="font-mono text-3xl font-bold text-good">{kept}</div>
          <div className="text-xs font-semibold text-good">kept</div>
        </div>
        <div className="rounded-xl bg-bad/10 p-3">
          <div className="font-mono text-3xl font-bold text-bad">{rejected.length}</div>
          <div className="text-xs font-semibold text-bad">rejected</div>
        </div>
      </div>
      <ul className="mt-4 flex max-h-80 flex-col gap-2 overflow-auto">
        <AnimatePresence>
          {rejected.map((r, i) => (
            <motion.li key={i} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-bad/25 bg-bad/5 p-2 text-sm">
              <span className="font-bold text-bad">✕ {r.reason}</span>
              <p className="line-clamp-2 text-muted">{r.prompt}</p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}

function QuestionEditor({ n, item, onChange, onDelete }: { n: number; item: Item; onChange: (p: Partial<Question>) => void; onDelete: () => void }) {
  const { q, flags } = item;
  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3">
        <span className="mt-2 font-mono text-muted">{n}.</span>
        <textarea
          value={q.prompt}
          onChange={(e) => onChange({ prompt: e.target.value.slice(0, 300) })}
          rows={2}
          aria-label={`Question ${n}`}
          className="flex-1 resize-none rounded-lg border border-transparent bg-transparent p-2 text-lg font-bold outline-none hover:border-line focus:border-brand"
        />
        <button onClick={onDelete} className="mt-2 text-sm font-semibold text-muted hover:text-bad" aria-label={`Delete question ${n}`}>
          Delete
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.choices.map((c, ci) => (
          <label key={ci} className={`flex items-center gap-2 rounded-xl border p-2 ${q.answer === ci ? "border-good bg-good/10" : "border-line"}`}>
            <input
              type="radio"
              name={`answer-${q.id}`}
              checked={q.answer === ci}
              onChange={() => onChange({ answer: ci })}
              className="accent-[var(--color-good)]"
              aria-label={`Mark choice ${CHOICE_STYLES[ci]!.letter} correct`}
            />
            <span className={`font-black ${CHOICE_STYLES[ci]!.text}`}>{CHOICE_STYLES[ci]!.letter}</span>
            <input
              value={c}
              onChange={(e) => onChange({ choices: q.choices.map((x, j) => (j === ci ? e.target.value.slice(0, 140) : x)) })}
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md bg-panel-2 px-2 py-1 font-semibold">{q.topic}</span>
        <select
          value={q.timeLimitSec}
          onChange={(e) => onChange({ timeLimitSec: Number(e.target.value) })}
          className="rounded-md border border-line bg-ink px-2 py-1"
          aria-label="Time limit"
        >
          {[...new Set([10, 15, 20, 30, 45, 60, q.timeLimitSec])].sort((a, b) => a - b).map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
        {flags.map((f) => (
          <span key={f} className="rounded-md bg-brand/15 px-2 py-1 font-semibold text-brand">
            ⚠ {FLAG_TEXT[f]}
          </span>
        ))}
      </div>
      {q.evidence && (
        <p className="mt-3 border-l-2 border-line pl-3 text-sm italic text-muted">
          “{q.evidence}” <span className="not-italic">— {q.sourceRef}</span>
        </p>
      )}
    </Panel>
  );
}
