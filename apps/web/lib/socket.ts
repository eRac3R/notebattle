"use client";
import { io, type Socket } from "socket.io-client";
import type { Ack, ClientToServer, ServerToClient } from "@notebattle/protocol";
import { SERVER_URL } from "./config";

export type GameSocket = Socket<ServerToClient, ClientToServer>;

let socket: GameSocket | null = null;

/** One shared connection per tab. */
export function getSocket(): GameSocket {
  socket ??= io(SERVER_URL, { transports: ["websocket", "polling"], reconnectionDelayMax: 3000 });
  return socket;
}

type AckData<E extends keyof ClientToServer> =
  Parameters<ClientToServer[E]> extends [...unknown[], Ack<infer T>] ? T : never;
type Payload<E extends keyof ClientToServer> =
  Parameters<ClientToServer[E]> extends [infer P, unknown] ? [P] : [];

/** Promise wrapper around acknowledged emits, with a timeout so the UI never hangs. */
export function request<E extends keyof ClientToServer>(event: E, ...payload: Payload<E>): Promise<AckData<E>> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The server took too long to answer")), 10_000);
    const ack = (res: { ok: true; data: AckData<E> } | { ok: false; error: string }) => {
      clearTimeout(timer);
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    };
    (s.emit as (...args: unknown[]) => void)(event, ...payload, ack);
  });
}
