"use client";
import { useEffect, useState } from "react";
import { SERVER_URL } from "@/lib/config";

type Status = "checking" | "waking" | "online" | "offline";

/**
 * Pings the game server as soon as a page opens. The free host sleeps when idle and takes
 * ~1 minute to wake, so starting the wake-up here hides most of it behind the upload step.
 */
export function ServerStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const ping = async () => {
      while (!cancelled && Date.now() - started < 120_000) {
        try {
          const res = await fetch(`${SERVER_URL}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            if (!cancelled) setStatus("online");
            return;
          }
        } catch {
          /* still asleep or unreachable */
        }
        if (!cancelled) setStatus("waking");
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) setStatus("offline");
    };
    void ping();
    return () => {
      cancelled = true;
    };
  }, []);

  const look: Record<Status, { dot: string; text: string }> = {
    checking: { dot: "bg-muted", text: "Connecting…" },
    waking: { dot: "bg-brand animate-pulse", text: "Waking the game server (free hosting, up to a minute)…" },
    online: { dot: "bg-good", text: "Game server online" },
    offline: { dot: "bg-bad", text: "Game server unreachable, try again later" },
  };
  const { dot, text } = look[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted" role="status" aria-live="polite">
      <span className={`size-2.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
