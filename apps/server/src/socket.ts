import type { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  AnswerPayloadSchema,
  CreateRoomPayloadSchema,
  GameSettingsSchema,
  JoinPayloadSchema,
  RoomCodeSchema,
  type Ack,
  type ClientToServer,
  type ServerToClient,
} from "@notebattle/protocol";
import { playersConnected, rejectedCommands } from "./metrics.js";
import { RoomError, type Broadcaster, type Logger, type RoomManager } from "./rooms.js";

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

interface SocketData {
  code?: string;
  role?: "host" | "player";
  playerId?: string;
}

export const hostChannel = (code: string) => `h:${code}`;
export const playerChannel = (playerId: string) => `p:${playerId}`;
/** Everyone in a room (hosts and players): used for room-wide notices. */
export const roomChannel = (code: string) => `r:${code}`;

export function socketBroadcaster(io: () => IO | null): Broadcaster {
  return {
    toHosts: (code, view) => io()?.to(hostChannel(code)).emit("room:view", view),
    toPlayer: (playerId, view) => io()?.to(playerChannel(playerId)).emit("room:view", view),
    kicked: (playerId) => {
      const server = io();
      if (!server) return;
      server.to(playerChannel(playerId)).emit("player:kicked");
      server.in(playerChannel(playerId)).disconnectSockets(true);
    },
    closed: (code, reason) => io()?.to(roomChannel(code)).emit("room:closed", reason),
  };
}

/** Token bucket per socket: protects the event loop from a spamming client. */
function limiter(capacity = 20, refillPerSec = 5) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** Wraps a handler: rate limit, validate, convert errors to `{ ok: false }` acks. */
function handler<P, T>(
  socket: Sock,
  allow: () => boolean,
  log: Logger,
  schema: z.ZodType<P> | null,
  fn: (payload: P) => Promise<T> | T,
) {
  return async (...args: unknown[]) => {
    const ack = args.at(-1) as Ack<T> | undefined;
    if (typeof ack !== "function") return; // every event in the contract is acknowledged
    if (!allow()) {
      rejectedCommands.inc({ reason: "rate_limited" });
      return ack({ ok: false, error: "Slow down" });
    }
    try {
      let payload = undefined as P;
      if (schema) {
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) return ack({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" });
        payload = parsed.data;
      }
      ack({ ok: true, data: await fn(payload) });
    } catch (err) {
      if (err instanceof RoomError) return ack({ ok: false, error: err.message });
      log.error({ err, socket: socket.id }, "socket handler failed");
      ack({ ok: false, error: "Something went wrong" });
    }
  };
}

export function registerSocketHandlers(io: IO, rooms: RoomManager, log: Logger): void {
  io.on("connection", (raw) => {
    const socket = raw as Sock;
    const allow = limiter();
    const h = <P, T>(schema: z.ZodType<P> | null, fn: (p: P) => Promise<T> | T) => handler(socket, allow, log, schema, fn);

    const requireHost = () => {
      if (socket.data.role !== "host" || !socket.data.code) throw new RoomError("Not the host of a room");
      return socket.data.code;
    };

    socket.on(
      "room:create",
      h(CreateRoomPayloadSchema, async ({ deck, settings }) => {
        const created = await rooms.create(deck, GameSettingsSchema.parse(settings ?? {}));
        return created;
      }),
    );

    socket.on(
      "host:attach",
      h(z.object({ code: RoomCodeSchema, hostKey: z.string().min(10).max(100) }), ({ code, hostKey }) => {
        if (!rooms.isHost(code, hostKey)) throw new RoomError("Not the host of this room");
        socket.data = { code, role: "host" };
        void socket.join([hostChannel(code), roomChannel(code)]);
        return rooms.hostView(code);
      }),
    );

    socket.on("host:start", h(null, () => (rooms.dispatch(requireHost(), { type: "start" }), null)));
    socket.on("host:next", h(null, () => (rooms.dispatch(requireHost(), { type: "next" }), null)));
    socket.on(
      "host:kick",
      h(z.object({ playerId: z.string().uuid() }), ({ playerId }) => (rooms.dispatch(requireHost(), { type: "kick", playerId }), null)),
    );

    socket.on(
      "player:join",
      h(JoinPayloadSchema, ({ code, name, resumeKey }) => {
        if (socket.data.role) throw new RoomError("This connection already joined a room");
        const { playerId, resumeKey: key } = rooms.join(code, name, resumeKey);
        socket.data = { code, role: "player", playerId };
        void socket.join([playerChannel(playerId), roomChannel(code)]);
        playersConnected.inc();
        return { playerId, resumeKey: key, view: rooms.playerView(code, playerId) };
      }),
    );

    socket.on(
      "player:answer",
      h(AnswerPayloadSchema, ({ questionIndex, choice }) => {
        const { code, playerId, role } = socket.data;
        if (role !== "player" || !code || !playerId) throw new RoomError("Join a room first");
        rooms.dispatch(code, { type: "answer", playerId, questionIndex, choice });
        return { accepted: true };
      }),
    );

    socket.on("disconnect", () => {
      const { code, playerId, role } = socket.data;
      if (role !== "player" || !code || !playerId) return;
      playersConnected.dec();
      // Only mark offline if no other tab of this player is still connected.
      const others = io.sockets.adapter.rooms.get(playerChannel(playerId));
      if (others && others.size > 0) return;
      try {
        rooms.dispatch(code, { type: "connection", playerId, connected: false });
      } catch {
        /* room closed or player kicked: nothing to update */
      }
    });
  });
}
