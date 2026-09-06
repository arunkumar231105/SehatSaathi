/**
 * The language layer.
 *
 * Two providers, one interface:
 *
 *   brain / memory  →  qwen3.8-27b (open weights) served by Groq
 *   embeddings      →  qwen3.7-text-embedding on Alibaba Cloud Model Studio
 *
 * Both are Qwen. The move to Groq is about which Qwen: the account's Model
 * Studio quota only covers `qwen-plus-character`, a roleplay-tuned model, and
 * a head-to-head on real patient turns showed why that matters —
 * qwen-plus-character invented family facts (called the patient's son "your
 * daughter"), drifted into Roman Urdu, and asserted medicines the patient did
 * not take. qwen3.8-27b answered "there is no mention of insulin in your
 * record" instead, in 100% Urdu script, roughly twice as fast.
 *
 * Model Studio stays the fallback for every chat call, so a Groq rate limit
 * degrades quality rather than breaking the conversation.
 */

const QWEN_BASE = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const GROQ_BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';

export const MODELS = {
  brain: process.env.MODEL_BRAIN ?? 'qwen/qwen3.8-27b',
  memory: process.env.MODEL_MEMORY ?? 'qwen/qwen3.8-27b',
  router: process.env.MODEL_ROUTER ?? 'qwen/qwen3.8-27b',
  embed: process.env.MODEL_EMBED ?? 'qwen3.7-text-embedding',
  /** Used when Groq is unavailable. Always a Model Studio model. */
  fallback: process.env.MODEL_FALLBACK ?? 'qwen-plus-character',
};

/** Groq model ids carry a vendor prefix; Model Studio ids never do. */
const isGroq = (model: string) => model.includes('/');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object; the caller still parses defensively. */
  json?: boolean;
}

async function once(model: string, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const groq = isGroq(model);
  const base = groq ? GROQ_BASE : QWEN_BASE;
  const key = groq ? process.env.GROQ_API_KEY : process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error(`no api key for ${groq ? 'groq' : 'model studio'}`);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 400,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`chat ${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  // Some Qwen builds emit a reasoning block before the answer; it must never
  // reach a patient (or a text-to-speech engine).
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const primary = opts.model ?? MODELS.brain;
  try {
    return await once(primary, messages, opts);
  } catch (err) {
    if (!isGroq(primary)) throw err;
    // Groq rate limits are frequent on the free tier and must not end a
    // conversation — fall back to Model Studio and carry on.
    console.warn('groq unavailable, falling back:', err instanceof Error ? err.message.slice(0, 120) : err);
    return once(MODELS.fallback, messages, opts);
  }
}

/**
 * Parse model JSON without trusting it. Models wrap output in ```json fences,
 * prepend prose, or trail with commentary; all of that is stripped before the
 * first balanced object is parsed.
 */
export function parseJson<T>(raw: string): T | null {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Embeddings stay on Alibaba Cloud Model Studio — 1024-d, matching the schema. */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${QWEN_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODELS.embed, input: text.slice(0, 6000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`qwen embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const v = data.data?.[0]?.embedding;
  if (!v || v.length !== 1024) throw new Error(`unexpected embedding size ${v?.length}`);
  return v;
}
