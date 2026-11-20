/**
 * Wire contract shared by server, web client and generator.
 * Everything that crosses a process boundary is defined (and validated) here.
 */
import { z } from "zod";

export const CHOICE_COUNT = 4;
export const ROOM_CODE_LENGTH = 6;
export const MAX_PLAYERS = 50;

/** A question as authored/generated. `answer` is the index into `choices`. */
export const QuestionSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: z.string().trim().min(8).max(300),
  choices: z.array(z.string().trim().min(1).max(140)).length(CHOICE_COUNT),
  answer: z.number().int().min(0).max(CHOICE_COUNT - 1),
  explanation: z.string().trim().max(500).default(""),
  topic: z.string().trim().min(1).max(60).default("General"),
  /** Verbatim quote from the user's notes that proves the answer ("source receipt"). */
  evidence: z.string().trim().max(600).default(""),
  /** Where the evidence lives, e.g. "page 3". */
  sourceRef: z.string().max(40).default(""),
  timeLimitSec: z.number().int().min(5).max(120).default(20),
});
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionInput = z.input<typeof QuestionSchema>;

export const DeckSchema = z.object({
  title: z.string().trim().min(1).max(80),
  questions: z.array(QuestionSchema).min(1).max(50),
});
export type Deck = z.infer<typeof DeckSchema>;

export const GameSettingsSchema = z.object({
  shuffleChoices: z.boolean().default(true),
  /** Seconds the reveal screen stays up before auto-advancing (0 = host clicks next). */
  autoAdvanceSec: z.number().int().min(0).max(30).default(0),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`), "Room codes are 6 letters/digits");

export const NicknameSchema = z
  .string()
  .trim()
  .min(1, "Pick a nickname")
  .max(20, "Max 20 characters")
  .regex(/^[\p{L}\p{N} _.-]+$/u, "Letters, numbers, space, _ . - only");

export type Phase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

/** What every client may see about a player. */
export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  streak: number;
  connected: boolean;
  answered: boolean;
}

/** A question as shown to players while it is live: no answer, no evidence. */
export interface LiveQuestion {
  index: number;
  total: number;
  prompt: string;
  choices: string[];
  topic: string;
  timeLimitSec: number;
  /** Server epoch ms at which answers stop being accepted. */
  deadline: number;
}

export interface RevealInfo {
  answer: number;
  explanation: string;
  evidence: string;
  sourceRef: string;
  /** How many players picked each choice. */
  distribution: number[];
}

export interface MyResult {
  choice: number | null;
  correct: boolean;
  points: number;
  streak: number;
  rank: number;
}

export interface TopicStat {
  topic: string;
  correct: number;
  attempts: number;
  accuracy: number;
}

export interface RoomView {
  code: string;
  title: string;
  phase: Phase;
  players: PublicPlayer[];
  question: LiveQuestion | null;
  reveal: RevealInfo | null;
  answeredCount: number;
  /** Only present in a player's own view. */
  me: (MyResult & { id: string; name: string; score: number }) | null;
  /** Present once finished: which topics the room struggled with. */
  topics: TopicStat[] | null;
  /** Id of the saved results page, once the finished game has been persisted. */
  resultsId: string | null;
  serverNow: number;
}

export interface GameResults {
  id: string;
  code: string;
  title: string;
  finishedAt: string;
  questionCount: number;
  players: Array<{ name: string; score: number; rank: number; correct: number; bestStreak: number }>;
  topics: TopicStat[];
}

/* ---------------- Socket.IO event maps ---------------- */

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  "room:create": (p: { deck: Deck; settings?: Partial<GameSettings> }, ack: Ack<{ code: string; hostKey: string }>) => void;
  "host:attach": (p: { code: string; hostKey: string }, ack: Ack<RoomView>) => void;
  "host:start": (ack: Ack<null>) => void;
  "host:next": (ack: Ack<null>) => void;
  "host:kick": (p: { playerId: string }, ack: Ack<null>) => void;
  "player:join": (p: { code: string; name: string; resumeKey?: string }, ack: Ack<{ playerId: string; resumeKey: string; view: RoomView }>) => void;
  "player:answer": (p: { questionIndex: number; choice: number }, ack: Ack<{ accepted: boolean }>) => void;
}

export interface ServerToClient {
  "room:view": (view: RoomView) => void;
  "room:closed": (reason: string) => void;
  "player:kicked": () => void;
}

export const JoinPayloadSchema = z.object({
  code: RoomCodeSchema,
  name: NicknameSchema,
  resumeKey: z.string().max(100).optional(),
});

export const AnswerPayloadSchema = z.object({
  questionIndex: z.number().int().min(0).max(100),
  choice: z.number().int().min(0).max(CHOICE_COUNT - 1),
});

export const CreateRoomPayloadSchema = z.object({
  deck: DeckSchema,
  settings: GameSettingsSchema.partial().optional(),
});

/* ---------------- Generation stream (HTTP NDJSON) ---------------- */

export type GenerationEvent =
  | { type: "parsed"; pages: number; chars: number; chunks: number }
  | { type: "progress"; done: number; total: number }
  | { type: "question"; question: Question; flags: QualityFlag[] }
  | { type: "rejected"; reason: string; prompt: string }
  | { type: "done"; title: string; kept: number; rejected: number; mode: "llm" | "offline"; ms: number }
  | { type: "error"; message: string };

export type QualityFlag =
  | "answer-longest"
  | "short-evidence"
  | "similar-choices"
  | "negative-prompt"
  | "unverified";
