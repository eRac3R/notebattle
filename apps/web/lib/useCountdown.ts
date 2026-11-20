"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Seconds left until a *server* deadline. Uses the offset between the server clock
 * (sent with every view) and this device, so a phone with a wrong clock still counts right.
 */
export function useCountdown(deadline: number | null, serverNow: number | null, limitSec: number): { left: number; frac: number } {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverNow) offset.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    if (!deadline) return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [deadline]);

  if (!deadline) return { left: 0, frac: 0 };
  const ms = Math.max(0, deadline - (now + offset.current));
  return { left: Math.ceil(ms / 1000), frac: Math.min(1, ms / (limitSec * 1000)) };
}
