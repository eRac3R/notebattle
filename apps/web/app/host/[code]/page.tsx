"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import type { RoomView } from "@notebattle/protocol";
import { Button, buttonClass, ChoiceTile, CountdownRing, EvidenceCard, Leaderboard, Logo, Panel, PlayerChips, Spinner, TopicReport } from "@/components/game";
import { getSocket, request } from "@/lib/socket";
import { hostKeyFor } from "@/lib/storage";
import { useCountdown } from "@/lib/useCountdown";

export default function HostPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);

  useEffect(() => {
    const key = hostKeyFor(code);
    if (!key) {
      setError("This browser tab is not the host of this room. Open the room from the tab that created it.");
      return;
    }
    const s = getSocket();
    const attach = () =>
      request("host:attach", { code, hostKey: key })
        .then(setView)
        .catch((e: Error) => setError(e.message));
    s.on("room:view", setView);
    s.on("room:closed", setClosed);
    s.on("connect", attach); // re-attach after a dropped connection
    if (s.connected) void attach();
    return () => {
      s.off("room:view", setView);
      s.off("room:closed", setClosed);
      s.off("connect", attach);
    };
  }, [code]);

  const act = useCallback(async (event: "host:start" | "host:next") => {
    setBusy(true);
    try {
      await request(event);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Presenter shortcut: space / enter / right arrow advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!view || busy || !["Space", "Enter", "ArrowRight"].includes(e.code)) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (view.phase === "lobby" && view.players.length > 0) void act("host:start");
      else if (view.phase === "reveal" || view.phase === "leaderboard") void act("host:next");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, busy, act]);

  if (closed) return <Centered title="Room closed" body={closed} />;
  if (error && !view) return <Centered title="Can't host this room" body={error} />;
  if (!view) return <Centered title="Connecting…" body={<Spinner />} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <Logo />
        <span className="truncate text-lg font-bold text-muted">{view.title}</span>
        <span className="rounded-lg bg-panel-2 px-3 py-1 font-mono text-lg font-bold tracking-widest">{code}</span>
      </header>
      {error && (
        <button onClick={() => setError(null)} className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-left font-semibold text-bad">
          {error} (dismiss)
        </button>
      )}
      <AnimatePresence mode="wait">
        <motion.section
          key={`${view.phase}-${view.question?.index ?? -1}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.25 }}
          className="flex flex-1 flex-col gap-6"
        >
          {view.phase === "lobby" && <Lobby view={view} busy={busy} onStart={() => void act("host:start")} />}
          {view.phase === "question" && <QuestionScreen view={view} />}
          {view.phase === "reveal" && <RevealScreen view={view} busy={busy} onNext={() => void act("host:next")} />}
          {view.phase === "leaderboard" && <LeaderboardScreen view={view} busy={busy} onNext={() => void act("host:next")} />}
          {view.phase === "finished" && <FinishedScreen view={view} />}
        </motion.section>
      </AnimatePresence>
    </main>
  );
}

function Centered({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <h1 className="text-3xl font-extrabold">{title}</h1>
        <div className="max-w-md text-muted">{body}</div>
        <a href="/" className="font-semibold text-brand">
          ← Home
        </a>
      </div>
    </main>
  );
}

function Lobby({ view, busy, onStart }: { view: RoomView; busy: boolean; onStart: () => void }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const joinUrl = `${origin}/play/${view.code}`;
  const kick = (playerId: string) => void request("host:kick", { playerId }).catch(() => {});
  return (
    <div className="grid flex-1 gap-8 lg:grid-cols-[auto_1fr]">
      <Panel className="flex flex-col items-center gap-5 p-8">
        <p className="text-lg font-semibold text-muted">Join at {origin.replace(/^https?:\/\//, "")} with code</p>
        <p className="font-mono text-7xl font-black tracking-[0.15em] text-brand">{view.code}</p>
        {origin && (
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={220} />
          </div>
        )}
        <p className="text-sm text-muted">or scan to join</p>
      </Panel>
      <div className="flex flex-col gap-6">
        <div className="flex items-end justify-between">
          <h2 className="text-4xl font-extrabold">
            {view.players.length} {view.players.length === 1 ? "player" : "players"} in
          </h2>
          <Button onClick={onStart} disabled={busy || view.players.length === 0} className="px-8 text-xl">
            Start battle ▶
          </Button>
        </div>
        {view.players.length === 0 ? (
          <p className="text-xl text-muted">Waiting for people to join…</p>
        ) : (
          <PlayerChips players={view.players} onKick={kick} />
        )}
        <p className="mt-auto text-sm text-muted">Tip: press Space to advance during the game.</p>
      </div>
    </div>
  );
}

function QuestionHeader({ view }: { view: RoomView }) {
  const q = view.question!;
  return (
    <div className="flex items-center gap-3 text-lg font-bold text-muted">
      <span className="rounded-lg bg-panel-2 px-3 py-1 font-mono">
        {q.index + 1}/{q.total}
      </span>
      <span>{q.topic}</span>
    </div>
  );
}

function QuestionScreen({ view }: { view: RoomView }) {
  const q = view.question!;
  const { left, frac } = useCountdown(q.deadline, view.serverNow, q.timeLimitSec);
  const live = view.players.filter((p) => p.connected).length;
  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-4">
          <QuestionHeader view={view} />
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">{q.prompt}</h1>
        </div>
        <CountdownRing left={left} frac={frac} size={120} />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
          <motion.div className="h-full rounded-full bg-brand-2" animate={{ width: `${(view.answeredCount / Math.max(1, live)) * 100}%` }} />
        </div>
        <span className="font-mono text-lg font-bold">
          {view.answeredCount}/{live} answered
        </span>
      </div>
      <div className="mt-auto grid gap-4 sm:grid-cols-2">
        {q.choices.map((c, i) => (
          <ChoiceTile key={i} index={i} text={c} big />
        ))}
      </div>
    </>
  );
}

function RevealScreen({ view, busy, onNext }: { view: RoomView; busy: boolean; onNext: () => void }) {
  const q = view.question!;
  const r = view.reveal!;
  const total = r.distribution.reduce((a, b) => a + b, 0);
  const right = r.distribution[r.answer] ?? 0;
  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-4">
          <QuestionHeader view={view} />
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{q.prompt}</h1>
        </div>
        <Panel className="shrink-0 px-6 py-4 text-center">
          <div className="font-mono text-4xl font-black text-good">
            {right}/{total}
          </div>
          <div className="text-sm font-semibold text-muted">got it right</div>
        </Panel>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {q.choices.map((c, i) => (
          <ChoiceTile key={i} index={i} text={c} big state={i === r.answer ? "correct" : "dim"} count={r.distribution[i]} />
        ))}
      </div>
      <EvidenceCard reveal={r} />
      <div className="mt-auto flex justify-end">
        <Button onClick={onNext} disabled={busy} className="px-8 text-xl">
          Scoreboard →
        </Button>
      </div>
    </>
  );
}

function LeaderboardScreen({ view, busy, onNext }: { view: RoomView; busy: boolean; onNext: () => void }) {
  const last = view.question!.index + 1 >= view.question!.total;
  return (
    <>
      <h1 className="text-5xl font-extrabold">Scoreboard</h1>
      <Leaderboard players={view.players} limit={6} />
      <div className="mt-auto flex justify-end">
        <Button onClick={onNext} disabled={busy} className="px-8 text-xl">
          {last ? "Final results 🏆" : "Next question →"}
        </Button>
      </div>
    </>
  );
}

const PODIUM = [
  { place: 2, h: "h-32", tone: "bg-[#c0c6dd]" },
  { place: 1, h: "h-44", tone: "bg-brand" },
  { place: 3, h: "h-24", tone: "bg-[#d08a52]" },
];

function FinishedScreen({ view }: { view: RoomView }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-6">
        <h1 className="text-5xl font-extrabold">Final results</h1>
        <div className="flex items-end justify-center gap-4 pt-8">
          {PODIUM.map(({ place, h, tone }, i) => {
            const p = view.players[place - 1];
            if (!p) return <div key={place} className="w-36" />;
            return (
              <motion.div
                key={place}
                className="flex w-36 flex-col items-center gap-2"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: [0.6, 1.2, 0.3][i], type: "spring" }}
              >
                <span className="text-center text-xl font-extrabold">{p.name}</span>
                <span className="font-mono text-muted">{p.score.toLocaleString()}</span>
                <div className={`grid w-full place-items-center rounded-t-2xl text-4xl font-black text-ink ${h} ${tone}`}>{place}</div>
              </motion.div>
            );
          })}
        </div>
        {view.players.length > 3 && <Leaderboard players={view.players.slice(3)} limit={10} />}
      </div>
      <Panel className="flex h-fit flex-col gap-5 p-6">
        <div>
          <h2 className="text-2xl font-extrabold">What the room should revise</h2>
          <p className="text-muted">Accuracy per topic, weakest first.</p>
        </div>
        {view.topics && <TopicReport topics={view.topics} />}
        <div className="flex flex-wrap gap-3 pt-2">
          {view.resultsId && (
            <a href={`/results/${view.resultsId}`} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
              Share results ↗
            </a>
          )}
          <a href="/create" className={buttonClass()}>
            New battle
          </a>
        </div>
      </Panel>
    </div>
  );
}
