"use client";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PublicPlayer, RevealInfo, TopicStat } from "@notebattle/protocol";
import { buttonClass, type Variant } from "./styles";

export { buttonClass };

export const CHOICE_STYLES = [
  { letter: "A", bg: "bg-choice-a", ring: "ring-choice-a", text: "text-choice-a" },
  { letter: "B", bg: "bg-choice-b", ring: "ring-choice-b", text: "text-choice-b" },
  { letter: "C", bg: "bg-choice-c", ring: "ring-choice-c", text: "text-choice-c" },
  { letter: "D", bg: "bg-choice-d", ring: "ring-choice-d", text: "text-choice-d" },
] as const;

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${size === "lg" ? "text-3xl" : "text-xl"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-ink shadow-[0_0_24px_-4px] shadow-brand/60">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="m10 13 2 2 4-4" />
        </svg>
      </span>
      Note<span className="text-brand">Battle</span>
    </span>
  );
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-panel/80 backdrop-blur ${className}`}>{children}</div>;
}

type TileState = "idle" | "picked" | "correct" | "wrong" | "dim";

export function ChoiceTile({
  index,
  text,
  state = "idle",
  onClick,
  disabled,
  count,
  big,
}: {
  index: number;
  text: string;
  state?: TileState;
  onClick?: () => void;
  disabled?: boolean;
  count?: number;
  big?: boolean;
}) {
  const c = CHOICE_STYLES[index]!;
  const look: Record<TileState, string> = {
    idle: `${c.bg} text-ink`,
    picked: `${c.bg} text-ink ring-4 ring-fg ring-offset-4 ring-offset-ink`,
    correct: `bg-good text-ink ring-4 ring-good/40`,
    wrong: `bg-panel-2 text-muted line-through decoration-2`,
    dim: `bg-panel-2 text-muted`,
  };
  return (
    <motion.button
      type="button"
      layout
      whileTap={onClick && !disabled ? { scale: 0.96 } : undefined}
      onClick={onClick}
      disabled={disabled || !onClick}
      className={`relative flex w-full items-center gap-4 rounded-2xl p-4 text-left font-bold transition-colors disabled:cursor-default ${big ? "min-h-28 text-2xl" : "min-h-20 text-lg"} ${look[state]}`}
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-lg font-black ${state === "idle" || state === "picked" ? "bg-ink/20" : "bg-ink/10"}`}>
        {state === "correct" ? "✓" : c.letter}
      </span>
      <span className="leading-snug">{text}</span>
      {count !== undefined && <span className="ml-auto rounded-lg bg-ink/20 px-3 py-1 font-mono text-base">{count}</span>}
    </motion.button>
  );
}

export function CountdownRing({ left, frac, size = 96 }: { left: number; frac: number; size?: number }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const urgent = left <= 5;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} className="fill-none stroke-line" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className={`fill-none transition-[stroke] ${urgent ? "stroke-bad" : "stroke-brand"}`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
        />
      </svg>
      <span className={`font-mono text-3xl font-bold tabular-nums ${urgent ? "text-bad" : ""}`}>{left}</span>
    </div>
  );
}

export function PlayerChips({ players, onKick }: { players: PublicPlayer[]; onKick?: (id: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      <AnimatePresence>
        {players.map((p) => (
          <motion.li
            key={p.id}
            layout
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className={`group flex items-center gap-2 rounded-full border border-line bg-panel-2 px-4 py-2 text-lg font-bold ${p.connected ? "" : "opacity-40"}`}
          >
            {p.name}
            {onKick && (
              <button onClick={() => onKick(p.id)} className="text-sm text-muted hover:text-bad" aria-label={`Remove ${p.name}`}>
                ✕
              </button>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

export function Leaderboard({ players, limit = 5, highlight }: { players: PublicPlayer[]; limit?: number; highlight?: string }) {
  const top = players.slice(0, limit);
  const max = Math.max(1, ...top.map((p) => p.score));
  return (
    <ol className="flex flex-col gap-3">
      {top.map((p, i) => (
        <motion.li
          key={p.id}
          layout
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className={`relative overflow-hidden rounded-xl border px-4 py-3 ${p.id === highlight ? "border-brand bg-brand/10" : "border-line bg-panel-2"}`}
        >
          <motion.div
            className="absolute inset-y-0 left-0 bg-brand-2/20"
            initial={{ width: 0 }}
            animate={{ width: `${(p.score / max) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
          <div className="relative flex items-center gap-4">
            <span className="w-8 font-mono text-xl font-bold text-muted">{i + 1}</span>
            <span className="text-xl font-bold">{p.name}</span>
            {p.streak >= 2 && <span className="rounded-full bg-brand/20 px-2 py-0.5 text-sm font-bold text-brand">🔥 {p.streak}</span>}
            <span className="ml-auto font-mono text-xl font-bold tabular-nums">{p.score.toLocaleString()}</span>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

/** The "receipt": the exact line of the user's own notes that proves the answer. */
export function EvidenceCard({ reveal, compact }: { reveal: RevealInfo; compact?: boolean }) {
  if (!reveal.evidence && !reveal.explanation) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <Panel className={compact ? "p-4" : "p-6"}>
        {reveal.evidence && (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand">
              <span>From your notes</span>
              {reveal.sourceRef && <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono normal-case tracking-normal">{reveal.sourceRef}</span>}
            </div>
            <blockquote className={`border-l-4 border-brand pl-4 italic leading-relaxed ${compact ? "text-base" : "text-xl"}`}>“{reveal.evidence}”</blockquote>
          </>
        )}
        {reveal.explanation && <p className={`mt-3 text-muted ${compact ? "text-sm" : "text-lg"}`}>{reveal.explanation}</p>}
      </Panel>
    </motion.div>
  );
}

export function TopicReport({ topics }: { topics: TopicStat[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {topics.map((t, i) => {
        const pct = Math.round(t.accuracy * 100);
        const tone = pct < 50 ? "bg-bad" : pct < 80 ? "bg-brand" : "bg-good";
        return (
          <li key={t.topic}>
            <div className="mb-1 flex items-baseline justify-between gap-4">
              <span className="font-bold">
                {t.topic}
                {i === 0 && pct < 80 && <span className="ml-2 rounded bg-bad/15 px-1.5 py-0.5 text-xs text-bad">revise first</span>}
              </span>
              <span className="font-mono text-sm text-muted">
                {t.correct}/{t.attempts} · {pct}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
              <motion.div className={`h-full rounded-full ${tone}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, delay: i * 0.08 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  );
}
