import { Logo } from "@/components/game";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <h1 className="text-3xl font-extrabold">Nothing here</h1>
        <p className="text-muted">That room or result doesn't exist (results are kept; rooms expire after the game).</p>
        <a href="/" className="font-semibold text-brand">
          ← Home
        </a>
      </div>
    </main>
  );
}
