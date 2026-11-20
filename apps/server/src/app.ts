import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import { RoomCodeSchema, type ClientToServer, type GenerationEvent, type ServerToClient } from "@notebattle/protocol";
import { generateDeck, InputError, MAX_INPUT_BYTES, type ChatClient } from "@notebattle/quizgen";
import type { Repo } from "./db/repo.js";
import { generatedQuestions, generationSeconds, registry } from "./metrics.js";
import { RoomManager } from "./rooms.js";
import { registerSocketHandlers, socketBroadcaster } from "./socket.js";

export interface AppOptions {
  repo: Repo;
  llm: ChatClient | null;
  /** CORS allow-list; `true` reflects any origin (dev only). */
  webOrigins: string[] | true;
  logger?: boolean | object;
  /** Max decks generated at the same time across all users (protects the free LLM quota). */
  maxConcurrentGenerations?: number;
  generationsPerMinute?: number;
}

export interface App {
  http: FastifyInstance;
  io: Server<ClientToServer, ServerToClient>;
  rooms: RoomManager;
  close(): Promise<void>;
}

export async function buildApp(opts: AppOptions): Promise<App> {
  const http = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: true, // behind the host's load balancer; needed for per-IP rate limits
  });

  let io: Server<ClientToServer, ServerToClient> | null = null;
  const rooms = new RoomManager({ repo: opts.repo, broadcaster: socketBroadcaster(() => io), logger: http.log });

  await http.register(cors, { origin: opts.webOrigins, methods: ["GET", "POST"] });
  await http.register(rateLimit, { global: false });
  await http.register(multipart, { limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 5 } });

  http.get("/healthz", async () => ({ ok: true }));
  http.get("/readyz", async (_req, reply) => {
    const db = await opts.repo.ping();
    return reply.code(db ? 200 : 503).send({ ok: db, db: opts.repo.kind, llm: opts.llm?.label ?? "offline", rooms: rooms.size });
  });
  http.get("/metrics", async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  http.get("/api/config", async () => ({ llm: opts.llm ? opts.llm.label : null }));

  http.get<{ Params: { code: string } }>("/api/rooms/:code", async (req, reply) => {
    const code = RoomCodeSchema.safeParse(req.params.code);
    const room = code.success ? rooms.exists(code.data) : null;
    if (!room) return reply.code(404).send({ error: "No room with that code" });
    return room;
  });

  http.get<{ Params: { id: string } }>("/api/results/:id", async (req, reply) => {
    const res = await opts.repo.getResults(req.params.id);
    return res ? res : reply.code(404).send({ error: "Results not found" });
  });

  let activeGenerations = 0;
  const maxGen = opts.maxConcurrentGenerations ?? 4;
  http.post(
    "/api/generate",
    { config: { rateLimit: { max: opts.generationsPerMinute ?? 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (activeGenerations >= maxGen) return reply.code(503).send({ error: "Busy generating other decks, try again in a minute" });
      let bytes: Uint8Array;
      let count = 10;
      let title: string | undefined;
      let filename: string | undefined;
      try {
        const file = await req.file();
        if (!file) return reply.code(400).send({ error: "Attach a PDF, .txt or .md file" });
        bytes = await file.toBuffer();
        filename = file.filename;
        const field = (name: string) => {
          const f = file.fields[name];
          return f && !Array.isArray(f) && f.type === "field" ? String(f.value) : undefined;
        };
        count = Math.min(Math.max(Number(field("count")) || 10, 3), 30);
        title = field("title")?.trim().slice(0, 80) || undefined;
      } catch (err) {
        const tooBig = (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE";
        return reply.code(tooBig ? 413 : 400).send({ error: tooBig ? "File is larger than 8 MB" : "Could not read the upload" });
      }

      const abort = new AbortController();
      req.raw.on("close", () => abort.abort());
      const llm = opts.llm;
      const started = Date.now();
      activeGenerations++;

      // NDJSON stream: the browser renders questions as they pass the quality gate.
      async function* stream(): AsyncGenerator<string> {
        let mode = llm ? "llm" : "offline";
        try {
          for await (const ev of generateDeck(bytes, { llm, count, title, filename, signal: abort.signal })) {
            track(ev, mode);
            if (ev.type === "done") mode = ev.mode;
            yield `${JSON.stringify(ev)}\n`;
          }
        } catch (err) {
          const message = err instanceof InputError ? err.message : "Generation failed";
          if (!(err instanceof InputError)) req.log.error({ err }, "generation failed");
          yield `${JSON.stringify({ type: "error", message } satisfies GenerationEvent)}\n`;
        } finally {
          activeGenerations--;
          generationSeconds.observe({ mode }, (Date.now() - started) / 1000);
        }
      }
      return reply
        .header("content-type", "application/x-ndjson; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("x-accel-buffering", "no")
        .send(Readable.from(stream()));
    },
  );

  await http.ready();
  io = new Server<ClientToServer, ServerToClient>(http.server, {
    cors: { origin: opts.webOrigins },
    maxHttpBufferSize: 512 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  registerSocketHandlers(io, rooms, http.log);
  const sweeper = setInterval(() => rooms.sweep(), 60_000);
  sweeper.unref();

  return {
    http,
    io,
    rooms,
    async close() {
      clearInterval(sweeper);
      rooms.closeAll();
      await new Promise<void>((resolve) => io!.close(() => resolve()));
      await http.close().catch(() => {});
      await opts.repo.close();
    },
  };
}

function track(ev: GenerationEvent, mode: string): void {
  if (ev.type === "question") generatedQuestions.inc({ outcome: "kept", mode });
  if (ev.type === "rejected") generatedQuestions.inc({ outcome: "rejected", mode });
}
