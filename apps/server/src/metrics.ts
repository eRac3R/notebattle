import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "notebattle_" });

export const roomsActive = new Gauge({ name: "notebattle_rooms_active", help: "Rooms in memory", registers: [registry] });
export const playersConnected = new Gauge({ name: "notebattle_players_connected", help: "Connected player sockets", registers: [registry] });
export const gamesFinished = new Counter({ name: "notebattle_games_finished_total", help: "Games played to the end", registers: [registry] });
export const answersTotal = new Counter({
  name: "notebattle_answers_total",
  help: "Answers accepted, by correctness",
  labelNames: ["correct"] as const,
  registers: [registry],
});
export const answerSeconds = new Histogram({
  name: "notebattle_answer_seconds",
  help: "Time from question open to accepted answer",
  buckets: [1, 2, 4, 6, 8, 10, 15, 20, 30, 40],
  registers: [registry],
});
export const rejectedCommands = new Counter({
  name: "notebattle_rejected_commands_total",
  help: "Commands refused by the engine or rate limiter",
  labelNames: ["reason"] as const,
  registers: [registry],
});
export const generatedQuestions = new Counter({
  name: "notebattle_generated_questions_total",
  help: "Generated questions by outcome",
  labelNames: ["outcome", "mode"] as const,
  registers: [registry],
});
export const generationSeconds = new Histogram({
  name: "notebattle_generation_seconds",
  help: "Wall time to generate a deck",
  labelNames: ["mode"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 40, 80],
  registers: [registry],
});
