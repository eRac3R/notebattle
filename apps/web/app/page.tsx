"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { Button, CHOICE_STYLES, Logo, Panel } from "@/components/game";

const STEPS = [
  { title: "Drop your notes", body: "A PDF or text file: semester notes, GATE material, slides exported to PDF." },
  { title: "AI writes the questions", body: "Each one must quote the exact line of your notes that proves it. No quote, no question." },
  { title: "Battle your friends", body: "They join from their phones with a 6-letter code. Live timer, streaks, scoreboard." },
  { title: "See what to revise", body: "After the game: which topics the whole room got wrong, weakest first." },
];

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const valid = /^[A-Z0-9]{6}$/.test(code);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-8 sm:px-8">
      <nav className="flex items-center justify-between">
        <Logo />
        <a href="https://github.com/eRac3R/notebattle" className="text-sm font-semibold text-muted hover:text-fg">
          GitHub
        </a>
      </nav>

      <section className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl"
          >
            Your notes.
            <br />
            Your friends.
            <br />
            <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">One battle.</span>
          </motion.h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Upload what you are studying. NoteBattle turns it into a live quiz your friends join from their phones, and every
            question comes with a receipt: the exact line in your notes that proves the answer.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="p-6">
            <h2 className="text-xl font-bold">Host a battle</h2>
            <p className="mt-1 text-muted">Upload notes, review the questions, open a room.</p>
            <Button className="mt-4 w-full text-lg" onClick={() => router.push("/create")}>
              Create from my notes →
            </Button>
          </Panel>
          <Panel className="p-6">
            <h2 className="text-xl font-bold">Join a battle</h2>
            <form
              className="mt-4 flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) router.push(`/play/${code}`);
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                placeholder="ROOM CODE"
                aria-label="Room code"
                autoCapitalize="characters"
                className="min-w-0 flex-1 rounded-xl border border-line bg-ink px-4 py-3 font-mono text-2xl tracking-[0.3em] uppercase outline-none placeholder:text-line focus:border-brand"
              />
              <Button type="submit" variant="ghost" disabled={!valid}>
                Join
              </Button>
            </form>
          </Panel>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}>
            <Panel className="h-full p-5">
              <span className={`grid size-9 place-items-center rounded-lg font-black text-ink ${CHOICE_STYLES[i]!.bg}`}>{i + 1}</span>
              <h3 className="mt-4 font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </Panel>
          </motion.div>
        ))}
      </section>
    </main>
  );
}
