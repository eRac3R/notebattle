import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createGame,
  hostView,
  LATENCY_GRACE_MS,
  playerView,
  reduce,
  standings,
  topicStats,
  type Command,
  type GameState,
} from "@notebattle/engine";
import type { Deck, GameSettings, RoomView } from "@notebattle/protocol";
import type { Repo } from "./db/repo.js";
import { answerSeconds, answersTotal, gamesFinished, rejectedCommands, roomsActive } from "./metrics.js";

/** How the room manager talks to clients; implemented with Socket.IO rooms in production. */
export interface Broadcaster {
  toHosts(code: string, view: RoomView): void;
  toPlayer(playerId: string, view: RoomView): void;
  kicked(playerId: string): void;
  closed(code: string, reason: string): void;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

interface Room {
  state: GameState;
  hostKey: string;
  deckId: string | null;
  /** resumeKey -> playerId: lets a refreshed tab reclaim its seat. */
  sessions: Map<string, string>;
  timer: NodeJS.Timeout | null;
  lastActivity: number;
  resultsId: string | null;
}

export interface RoomManagerOptions {
  repo: Repo;
  broadcaster: Broadcaster;
  logger: Logger;
  now?: () => number;
  maxRooms?: number;
  idleMs?: number;
}

// No 0/O/1/I: codes get read aloud and typed on phones.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomError extends Error {}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;
  private readonly maxRooms: number;
  private readonly idleMs: number;

  constructor(private readonly opts: RoomManagerOptions) {
    this.now = opts.now ?? Date.now;
    this.maxRooms = opts.maxRooms ?? 200;
    this.idleMs = opts.idleMs ?? 2 * 60 * 60 * 1000;
  }

  get size(): number {
    return this.rooms.size;
  }

  async create(deck: Deck, settings: GameSettings): Promise<{ code: string; hostKey: string }> {
    this.sweep();
    if (this.rooms.size >= this.maxRooms) throw new RoomError("Server is busy, try again in a few minutes");
    let code: string;
    do code = randomCode();
    while (this.rooms.has(code));
    let deckId: string | null = null;
    try {
      deckId = await this.opts.repo.saveDeck(deck);
    } catch (err) {
      // A DB hiccup must not block a live game; the deck just isn't saved.
      this.opts.logger.error({ err }, "saveDeck failed");
    }
    const hostKey = randomBytes(24).toString("base64url");
    const seed = randomBytes(4).readUInt32LE();
    this.rooms.set(code, {
      state: createGame(code, deck, settings, seed),
      hostKey,
      deckId,
      sessions: new Map(),
      timer: null,
      lastActivity: this.now(),
      resultsId: null,
    });
    roomsActive.set(this.rooms.size);
    this.opts.logger.info({ code, questions: deck.questions.length }, "room created");
    return { code, hostKey };
  }

  exists(code: string): { phase: GameState["phase"]; title: string; players: number } | null {
    const r = this.rooms.get(code);
    return r ? { phase: r.state.phase, title: r.state.title, players: r.state.players.length } : null;
  }

  isHost(code: string, hostKey: string): boolean {
    const r = this.rooms.get(code);
    if (!r) return false;
    const a = Buffer.from(r.hostKey);
    const b = Buffer.from(hostKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  hostView(code: string): RoomView {
    const r = this.mustGet(code);
    return { ...hostView(r.state, this.now()), resultsId: r.resultsId };
  }

  playerView(code: string, playerId: string): RoomView {
    const r = this.mustGet(code);
    return { ...playerView(r.state, playerId, this.now()), resultsId: r.resultsId };
  }

  /** Join, or reclaim a seat with a resume key (page refresh / flaky mobile network). */
  join(code: string, name: string, resumeKey?: string): { playerId: string; resumeKey: string } {
    const r = this.mustGet(code);
    if (resumeKey) {
      const playerId = r.sessions.get(resumeKey);
      if (playerId && r.state.players.some((p) => p.id === playerId)) {
        this.dispatch(code, { type: "connection", playerId, connected: true });
        return { playerId, resumeKey };
      }
    }
    const playerId = randomUUID();
    this.dispatch(code, { type: "join", playerId, name });
    const key = randomBytes(18).toString("base64url");
    r.sessions.set(key, playerId);
    return { playerId, resumeKey: key };
  }

  /** Applies a command; throws RoomError with a user-facing message when refused. */
  dispatch(code: string, cmd: Command): void {
    const r = this.mustGet(code);
    const now = this.now();
    const res = reduce(r.state, cmd, now);
    if (!res.ok) {
      rejectedCommands.inc({ reason: cmd.type });
      throw new RoomError(res.error);
    }
    if (!res.changed) return;
    const prev = r.state;
    r.state = res.state;
    r.lastActivity = now;
    this.observe(r.state, cmd);
    if (cmd.type === "kick") this.opts.broadcaster.kicked(cmd.playerId);
    this.schedule(code, r);
    this.broadcast(code, r);
    if (r.state.phase === "finished" && prev.phase !== "finished") void this.persist(code, r);
  }

  private observe(next: GameState, cmd: Command): void {
    if (cmd.type !== "answer") return;
    const a = next.players.find((p) => p.id === cmd.playerId)?.answers[cmd.questionIndex];
    if (!a) return;
    answersTotal.inc({ correct: String(a.correct) });
    answerSeconds.observe(a.elapsedMs / 1000);
  }

  private broadcast(code: string, r: Room): void {
    const now = this.now();
    this.opts.broadcaster.toHosts(code, { ...hostView(r.state, now), resultsId: r.resultsId });
    for (const p of r.state.players) {
      if (p.connected) this.opts.broadcaster.toPlayer(p.id, { ...playerView(r.state, p.id, now), resultsId: r.resultsId });
    }
  }

  /** One timer per room: closes the question at the deadline, or auto-advances the reveal. */
  private schedule(code: string, r: Room): void {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    const s = r.state;
    let delay: number | null = null;
    let cmd: Command | null = null;
    if (s.phase === "question") {
      delay = s.deadline - this.now() + LATENCY_GRACE_MS + 5;
      cmd = { type: "tick" };
    } else if ((s.phase === "reveal" || s.phase === "leaderboard") && s.settings.autoAdvanceSec > 0) {
      delay = s.settings.autoAdvanceSec * 1000;
      cmd = { type: "next" };
    }
    if (delay === null || cmd === null) return;
    const version = s.version;
    const fire = cmd;
    r.timer = setTimeout(() => {
      const cur = this.rooms.get(code);
      if (!cur || cur.state.version !== version) return; // stale timer: state moved on
      try {
        this.dispatch(code, fire);
      } catch (err) {
        this.opts.logger.error({ err, code }, "timer dispatch failed");
      }
    }, Math.max(0, delay));
    r.timer.unref?.();
  }

  private async persist(code: string, r: Room): Promise<void> {
    gamesFinished.inc();
    const s = r.state;
    try {
      r.resultsId = await this.opts.repo.saveGame({
        code,
        deckId: r.deckId,
        title: s.title,
        questionCount: s.questions.length,
        topics: topicStats(s),
        players: standings(s).map(({ player: p, rank }) => ({
          name: p.name,
          score: p.score,
          rank,
          correct: Object.values(p.answers).filter((a) => a.correct).length,
          bestStreak: p.bestStreak,
        })),
      });
      if (this.rooms.get(code) === r) this.broadcast(code, r);
    } catch (err) {
      this.opts.logger.error({ err, code }, "saveGame failed");
    }
  }

  /** Drops idle rooms and finished rooms after 30 minutes. */
  sweep(): void {
    const now = this.now();
    for (const [code, r] of this.rooms) {
      const ttl = r.state.phase === "finished" ? 30 * 60 * 1000 : this.idleMs;
      if (now - r.lastActivity > ttl) this.close(code, "Room expired");
    }
  }

  close(code: string, reason: string): void {
    const r = this.rooms.get(code);
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    this.rooms.delete(code);
    roomsActive.set(this.rooms.size);
    this.opts.broadcaster.closed(code, reason);
  }

  closeAll(): void {
    for (const code of [...this.rooms.keys()]) this.close(code, "Server restarting");
  }

  private mustGet(code: string): Room {
    const r = this.rooms.get(code);
    if (!r) throw new RoomError("No room with that code");
    return r;
  }
}

function randomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
