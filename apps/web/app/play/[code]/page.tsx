"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NicknameSchema, type RoomView } from "@notebattle/protocol";
import { Button, CHOICE_STYLES, EvidenceCard, Logo, Panel, Spinner, TopicReport } from "@/components/game";
import { getSocket, request } from "@/lib/socket";
import { lastName, resumeKeyFor, saveName, saveResumeKey } from "@/lib/storage";
import { useCountdown } from "@/lib/useCountdown";

export default function PlayPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const [view, setView] = useState<RoomView | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const joined = useRef(false);

  async function join(nick: string, resumeKey?: string) {
    setJoining(true);
    setError(null);
    try {
      const res = await request("player:join", { code, name: nick, ...(resumeKey ? { resumeKey } : {}) });
      saveResumeKey(code, res.resumeKey);
      saveName(nick);
      joined.current = true;
      setView(res.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  useEffect(() => {
    setName(lastName());
    const s = getSocket();
    const onKicked = () => setEnded("The host removed you from this room.");
    const onClosed = (reason: string) => setEnded(reason);
    // After a dropped connection, silently reclaim the seat with the resume key.
    const onConnect = () => {
      const key = resumeKeyFor(code);
      if (key) void join(lastName() || "player", key);
    };
    s.on("room:view", setView);
    s.on("player:kicked", onKicked);
    s.on("room:closed", onClosed);
    s.on("connect", onConnect);
    if (s.connected) onConnect();
    return () => {
      s.off("room:view", setView);
      s.off("player:kicked", onKicked);
      s.off("room:closed", onClosed);
      s.off("connect", onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (ended) return <Shell code={code}><Message title="Game over for you" body={ended} /></Shell>;

  if (!view?.me) {
    const parsed = NicknameSchema.safeParse(name);
    return (
      <Shell code={code}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success) void join(parsed.data);
          }}
        >
          <h1 className="text-3xl font-extrabold">Pick a nickname</h1>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            placeholder="e.g. Riya"
            aria-label="Nickname"
            className="rounded-xl border border-line bg-ink px-4 py-4 text-2xl font-bold outline-none focus:border-brand"
          />
          {error && <p className="font-semibold text-bad">{error}</p>}
          <Button type="submit" disabled={!parsed.success || joining} className="py-4 text-xl">
            {joining ? "Joining…" : "Join battle"}
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell code={code} me={view.me}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${view.phase}-${view.question?.index ?? -1}`}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="flex flex-1 flex-col"
        >
          {view.phase === "lobby" && (
            <Message title="You're in!" body={<>Look at the host screen. {view.players.length} {view.players.length === 1 ? "player" : "players"} so far.</>} />
          )}
          {view.phase === "question" && <Answer view={view} />}
          {view.phase === "reveal" && <Result view={view} />}
          {view.phase === "leaderboard" && (
            <Message
              title={`#${view.me.rank} of ${view.players.length}`}
              body={<span className="font-mono text-2xl font-bold text-fg">{view.me.score.toLocaleString()} pts</span>}
            />
          )}
          {view.phase === "finished" && <Final view={view} />}
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

function Shell({ code, me, children }: { code: string; me?: RoomView["me"]; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-5">
      <header className="flex items-center justify-between">
        <Logo />
        {me ? (
          <span className="rounded-lg bg-panel-2 px-3 py-1 text-sm font-bold">
            {me.name} · <span className="font-mono">{me.score.toLocaleString()}</span>
          </span>
        ) : (
          <span className="font-mono font-bold tracking-widest text-muted">{code}</span>
        )}
      </header>
      {children}
    </main>
  );
}

function Message({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-4xl font-extrabold">{title}</h1>
      <div className="text-lg text-muted">{body}</div>
    </div>
  );
}

function Answer({ view }: { view: RoomView }) {
  const q = view.question!;
  const { left, frac } = useCountdown(q.deadline, view.serverNow, q.timeLimitSec);
  const [picked, setPicked] = useState<number | null>(view.me?.choice ?? null);
  const [err, setErr] = useState<string | null>(null);
  const choice = view.me?.choice ?? picked;

  async function pick(i: number) {
    if (choice !== null) return;
    setPicked(i);
    navigator.vibrate?.(30);
    try {
      await request("player:answer", { questionIndex: q.index, choice: i });
    } catch (e) {
      setPicked(null);
      setErr((e as Error).message);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between text-sm font-bold text-muted">
        <span>
          Question {q.index + 1}/{q.total}
        </span>
        <span className={`font-mono text-lg ${left <= 5 ? "text-bad" : "text-fg"}`}>{left}s</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-brand" style={{ width: `${frac * 100}%` }} />
      </div>
      <p className="text-xl font-bold leading-snug">{q.prompt}</p>
      {choice !== null ? (
        <Message
          title="Locked in"
          body={
            <span className="inline-flex items-center gap-2">
              You picked <b className={CHOICE_STYLES[choice]!.text}>{CHOICE_STYLES[choice]!.letter}</b>. Waiting for the others…
            </span>
          }
        />
      ) : left === 0 ? (
        <Message title="Time's up" body="Too slow this round!" />
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-3">
          {q.choices.map((c, i) => (
            <motion.button
              key={i}
              whileTap={{ scale: 0.96 }}
              onClick={() => void pick(i)}
              className={`flex items-center gap-3 rounded-2xl p-4 text-left text-lg font-bold text-ink ${CHOICE_STYLES[i]!.bg}`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink/20 font-black">{CHOICE_STYLES[i]!.letter}</span>
              {c}
            </motion.button>
          ))}
        </div>
      )}
      {err && <p className="text-center font-semibold text-bad">{err}</p>}
    </div>
  );
}

function Result({ view }: { view: RoomView }) {
  const me = view.me!;
  const r = view.reveal!;
  const answered = me.choice !== null;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className={`flex flex-col items-center gap-2 rounded-3xl p-8 text-center ${me.correct ? "bg-good text-ink" : "bg-bad/90 text-ink"}`}
      >
        <span className="text-6xl">{me.correct ? "✓" : "✕"}</span>
        <span className="text-3xl font-extrabold">{me.correct ? "Correct!" : answered ? "Not quite" : "No answer"}</span>
        {me.correct && <span className="font-mono text-2xl font-bold">+{me.points}</span>}
        {me.streak >= 2 && <span className="rounded-full bg-ink/20 px-3 py-1 font-bold">🔥 {me.streak} in a row</span>}
      </motion.div>
      {!me.correct && (
        <Panel className="p-4 text-center">
          Answer: <b className={CHOICE_STYLES[r.answer]!.text}>{CHOICE_STYLES[r.answer]!.letter}</b> {view.question!.choices[r.answer]}
        </Panel>
      )}
      <EvidenceCard reveal={r} compact />
      <p className="text-center text-muted">
        You're <b className="text-fg">#{me.rank}</b> of {view.players.length}
      </p>
    </div>
  );
}

function Final({ view }: { view: RoomView }) {
  const me = view.me!;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1 py-6 text-center">
        <span className="text-6xl">{["🏆", "🥈", "🥉"][me.rank - 1] ?? "🎯"}</span>
        <h1 className="text-4xl font-extrabold">#{me.rank} of {view.players.length}</h1>
        <p className="font-mono text-xl text-muted">{me.score.toLocaleString()} pts</p>
      </div>
      {view.topics && (
        <Panel className="p-5">
          <h2 className="mb-4 font-extrabold">Revise these first</h2>
          <TopicReport topics={view.topics} />
        </Panel>
      )}
      {view.resultsId ? (
        <a href={`/results/${view.resultsId}`} className="text-center font-semibold text-brand">
          Full results ↗
        </a>
      ) : (
        <Spinner label="Saving results…" />
      )}
    </div>
  );
}
