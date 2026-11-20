import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { GameResults } from "@notebattle/protocol";
import { Logo, Panel, TopicReport } from "@/components/game";
import { buttonClass } from "@/components/styles";
import { SERVER_URL } from "@/lib/config";

type Props = { params: Promise<{ id: string }> };

async function load(id: string): Promise<GameResults | null> {
  const res = await fetch(`${SERVER_URL}/api/results/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as GameResults;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).id);
  return { title: r ? `${r.title} · NoteBattle results` : "Results · NoteBattle" };
}

export default async function ResultsPage({ params }: Props) {
  const r = await load((await params).id);
  if (!r) notFound();
  const medal = ["🏆", "🥈", "🥉"];
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-8">
      <nav className="flex items-center justify-between">
        <a href="/">
          <Logo />
        </a>
        <a href="/create" className={buttonClass("primary", "py-2")}>
          Make your own
        </a>
      </nav>
      <header>
        <p className="font-semibold text-muted">
          Battle results · {new Date(r.finishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </p>
        <h1 className="text-5xl font-extrabold tracking-tight">{r.title}</h1>
        <p className="mt-2 text-muted">
          {r.players.length} players · {r.questionCount} questions
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel className="p-2">
          <table className="w-full">
            <thead className="text-left text-sm text-muted">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Player</th>
                <th className="p-3 text-right">Correct</th>
                <th className="p-3 text-right">Best streak</th>
                <th className="p-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {r.players.map((p) => (
                <tr key={`${p.rank}-${p.name}`} className="border-t border-line">
                  <td className="p-3 font-mono font-bold">{medal[p.rank - 1] ?? p.rank}</td>
                  <td className="p-3 font-bold">{p.name}</td>
                  <td className="p-3 text-right font-mono">
                    {p.correct}/{r.questionCount}
                  </td>
                  <td className="p-3 text-right font-mono">{p.bestStreak}</td>
                  <td className="p-3 text-right font-mono font-bold">{p.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel className="h-fit p-6">
          <h2 className="mb-1 text-xl font-extrabold">Topics, weakest first</h2>
          <p className="mb-4 text-sm text-muted">What this group should revise next.</p>
          <TopicReport topics={r.topics} />
        </Panel>
      </div>
    </main>
  );
}
