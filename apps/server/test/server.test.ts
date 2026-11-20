import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { DeckSchema, type ClientToServer, type Deck, type GameResults, type GenerationEvent, type RoomView, type ServerToClient } from "@notebattle/protocol";
import { buildApp, type App } from "../src/app.js";
import { MemoryRepo } from "../src/db/repo.js";
import { RoomManager, type Broadcaster } from "../src/rooms.js";

type Client = Socket<ServerToClient, ClientToServer>;

const deck: Deck = DeckSchema.parse({
  title: "Networks",
  questions: [
    {
      id: "n1",
      prompt: "Which layer does TCP belong to?",
      choices: ["Transport", "Network", "Link", "Application"],
      answer: 0,
      evidence: "TCP is a transport layer protocol",
      explanation: "SECRET-EXPLANATION-1",
      topic: "Transport",
      timeLimitSec: 20,
    },
    {
      id: "n2",
      prompt: "What does DNS translate?",
      choices: ["Names to IP addresses", "MACs to IPs", "Ports to sockets", "IPs to MACs"],
      answer: 0,
      evidence: "DNS maps domain names to IP addresses",
      explanation: "SECRET-EXPLANATION-2",
      topic: "Application",
      timeLimitSec: 20,
    },
  ],
});

let app: App;
let url: string;
const sockets: Client[] = [];

beforeAll(async () => {
  app = await buildApp({ repo: new MemoryRepo(), llm: null, webOrigins: ["http://localhost:3000"] });
  await app.http.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
});

async function client(): Promise<Client> {
  const s: Client = connect(url, { transports: ["websocket"], forceNew: true });
  sockets.push(s);
  await new Promise<void>((res, rej) => {
    s.once("connect", () => res());
    s.once("connect_error", rej);
  });
  return s;
}

/** Emits with an ack and unwraps `{ ok, data }`. */
function call<T>(s: Client, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    (s.emit as (...a: unknown[]) => void)(event, ...args, (res: { ok: boolean; data?: T; error?: string }) =>
      res.ok ? resolve(res.data as T) : reject(new Error(res.error)),
    );
  });
}

function nextView(s: Client, phase: RoomView["phase"], pred: (v: RoomView) => boolean = () => true): Promise<RoomView> {
  return new Promise((resolve) => {
    const on = (v: RoomView) => {
      if (v.phase === phase && pred(v)) {
        s.off("room:view", on);
        resolve(v);
      }
    };
    s.on("room:view", on);
  });
}

async function hostRoom() {
  const host = await client();
  const { code, hostKey } = await call<{ code: string; hostKey: string }>(host, "room:create", { deck, settings: { shuffleChoices: false } });
  await call(host, "host:attach", { code, hostKey });
  return { host, code, hostKey };
}

describe("game over websockets", () => {
  it("plays a full game; nobody sees the answer before the reveal; results are saved", async () => {
    const { host, code } = await hostRoom();
    const players = await Promise.all(["ann", "bob", "cat"].map(async (name) => {
      const s = await client();
      const seen: RoomView[] = [];
      s.on("room:view", (v) => seen.push(v));
      const joined = await call<{ playerId: string; view: RoomView }>(s, "player:join", { code, name });
      return { s, seen, ...joined };
    }));
    const hostSeen: RoomView[] = [];
    host.on("room:view", (v) => hostSeen.push(v));

    for (let q = 0; q < deck.questions.length; q++) {
      const open = nextView(players[0]!.s, "question", (v) => v.question?.index === q);
      await call(host, q === 0 ? "host:start" : "host:next");
      await open;
      const revealed = nextView(host, "reveal");
      // ann right, bob wrong, cat right
      await call(players[0]!.s, "player:answer", { questionIndex: q, choice: 0 });
      await call(players[1]!.s, "player:answer", { questionIndex: q, choice: 2 });
      await call(players[2]!.s, "player:answer", { questionIndex: q, choice: 0 });
      const r = await revealed;
      expect(r.reveal?.distribution).toEqual([2, 0, 1, 0]);
      const board = nextView(host, "leaderboard");
      await call(host, "host:next");
      await board;
    }

    const finished = nextView(host, "finished", (v) => v.resultsId !== null);
    await call(host, "host:next");
    const final = await finished;

    // The anti-cheat guarantee, checked on every message any client received.
    for (const v of [...hostSeen, ...players.flatMap((p) => p.seen)]) {
      if (v.phase === "question") {
        const json = JSON.stringify(v);
        expect(json).not.toContain("SECRET-EXPLANATION");
        expect(json).not.toContain("transport layer protocol");
        expect(v.reveal).toBeNull();
      }
    }

    expect(final.players.map((p) => p.name)).toEqual(["ann", "cat", "bob"]);
    expect(final.topics?.map((t) => t.accuracy)).toEqual([2 / 3, 2 / 3]);
    const res = (await fetch(`${url}/api/results/${final.resultsId}`).then((r) => r.json())) as GameResults;
    expect(res).toMatchObject({ title: "Networks", questionCount: 2 });
    expect(res.players[2]).toMatchObject({ name: "bob", score: 0, rank: 3, correct: 0 });
  });

  it("a refreshed tab reclaims its seat and score with the resume key", async () => {
    const { host, code } = await hostRoom();
    const a = await client();
    const first = await call<{ playerId: string; resumeKey: string }>(a, "player:join", { code, name: "dee" });
    await call(host, "host:start");
    await call(a, "player:answer", { questionIndex: 0, choice: 0 });
    a.disconnect();
    const b = await client();
    const again = await call<{ playerId: string; view: RoomView }>(b, "player:join", { code, name: "ignored", resumeKey: first.resumeKey });
    expect(again.playerId).toBe(first.playerId);
    expect(again.view.me?.score).toBeGreaterThan(0);
  });

  it("enforces host authority and validates payloads", async () => {
    const { code } = await hostRoom();
    const p = await client();
    await expect(call(p, "host:attach", { code, hostKey: "x".repeat(32) })).rejects.toThrow("Not the host");
    await call(p, "player:join", { code, name: "eve" });
    await expect(call(p, "host:start")).rejects.toThrow("Not the host");
    await expect(call(p, "player:answer", { questionIndex: 0, choice: 9 })).rejects.toThrow();
    await expect(call(await client(), "player:join", { code: "nope", name: "x" })).rejects.toThrow(/6 letters/);
    await expect(call(await client(), "player:join", { code, name: "<script>" })).rejects.toThrow(/Letters/);
  });

  it("rate-limits a spamming socket", async () => {
    const p = await client();
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => call(p, "player:answer", { questionIndex: 0, choice: 0 })));
    const limited = results.filter((r) => r.status === "rejected" && /Slow down/.test(String(r.reason)));
    expect(limited.length).toBeGreaterThan(10);
  });
});

describe("HTTP API", () => {
  it("streams an offline-generated deck as NDJSON", async () => {
    const form = new FormData();
    form.set("count", "6");
    form.set("file", new Blob([readFileSync(new URL("../../../samples/os-notes.md", import.meta.url))]), "os-notes.md");
    const res = await fetch(`${url}/api/generate`, { method: "POST", body: form });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as GenerationEvent);
    expect(events[0]).toMatchObject({ type: "parsed", chunks: 5 });
    expect(events.filter((e) => e.type === "question")).toHaveLength(6);
    expect(events.at(-1)).toMatchObject({ type: "done", mode: "offline", kept: 6 });
  });

  it("returns a friendly error event for junk uploads", async () => {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([0, 1, 2, 0])]), "x.bin");
    const text = await fetch(`${url}/api/generate`, { method: "POST", body: form }).then((r) => r.text());
    expect(JSON.parse(text.trim())).toEqual({ type: "error", message: "Unsupported file: upload a PDF, .txt or .md" });
  });

  it("exposes health, readiness and Prometheus metrics", async () => {
    expect(await fetch(`${url}/readyz`).then((r) => r.json())).toMatchObject({ ok: true, db: "memory", llm: "offline" });
    const metrics = await fetch(`${url}/metrics`).then((r) => r.text());
    expect(metrics).toContain("notebattle_answers_total");
    expect(metrics).toContain("notebattle_generated_questions_total");
  });

  it("404s unknown rooms and results", async () => {
    expect((await fetch(`${url}/api/rooms/ZZZZZZ`)).status).toBe(404);
    expect((await fetch(`${url}/api/results/not-a-uuid`)).status).toBe(404);
  });
});

describe("room timers", () => {
  it("closes a question at its deadline even if nobody answers, and ignores stale timers", async () => {
    vi.useFakeTimers();
    try {
      const views: RoomView[] = [];
      const b: Broadcaster = { toHosts: (_c, v) => views.push(v), toPlayer: () => {}, kicked: () => {}, closed: () => {} };
      const rooms = new RoomManager({ repo: new MemoryRepo(), broadcaster: b, logger: { info() {}, error() {} } });
      const { code } = await rooms.create(deck, { shuffleChoices: false, autoAdvanceSec: 0 });
      const { playerId } = rooms.join(code, "solo");
      rooms.dispatch(code, { type: "start" });
      await vi.advanceTimersByTimeAsync(19_000);
      expect(rooms.hostView(code).phase).toBe("question");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(rooms.hostView(code).phase).toBe("reveal");
      expect(rooms.playerView(code, playerId).me?.choice).toBeNull();
      rooms.closeAll();
    } finally {
      vi.useRealTimers();
    }
  });
});
