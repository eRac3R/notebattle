/**
 * Provider-neutral OpenAI-compatible chat client (Groq, OpenRouter, Gemini's OpenAI
 * endpoint, Ollama, LM Studio...). No vendor SDK, just fetch.
 */

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

export interface ChatClient {
  readonly label: string;
  chat(messages: ChatMessage[], opts?: { json?: boolean; temperature?: number }): Promise<ChatResult>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenAICompatClient implements ChatClient {
  readonly label: string;
  constructor(
    private readonly cfg: LLMConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.label = cfg.model;
  }

  async chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<ChatResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    };
    const maxRetries = this.cfg.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 45_000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new LLMError(`LLM request failed: ${(err as Error).message}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20_000) : backoff(attempt));
        continue;
      }
      if (!res.ok) {
        // Never echo the response body verbatim: some providers include request details.
        throw new LLMError(`LLM provider returned HTTP ${res.status}`, res.status);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LLMError("LLM returned no content");
      return {
        content,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        ms: Date.now() - started,
      };
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

/** Reads NOTEBATTLE_LLM_* env vars. Returns null when no model is configured (offline mode). */
export function llmFromEnv(env: Record<string, string | undefined> = process.env): ChatClient | null {
  const mode = env.NOTEBATTLE_LLM_MODE ?? "auto";
  if (mode === "offline") return null;
  const baseUrl = env.NOTEBATTLE_LLM_BASE_URL;
  const model = env.NOTEBATTLE_LLM_MODEL;
  if (!baseUrl || !model) return null;
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  const apiKey = env.NOTEBATTLE_LLM_API_KEY || undefined;
  if (!apiKey && !isLocal) return null;
  return new OpenAICompatClient({ baseUrl, model, apiKey });
}

/** Pulls the first JSON object out of a reply, tolerating ```json fences and chatter. */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new LLMError("Reply contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}
