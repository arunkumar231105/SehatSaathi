/**
 * Qwen via the OpenAI-compatible endpoint (Singapore / International).
 *
 * The account's free quota covers qwen-plus-character and qwen-flash-character
 * for chat, and qwen3.7-text-embedding (1024-d) for vectors. All calls go
 * through here so model IDs and the endpoint live in exactly one place.
 */

const BASE = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const KEY = () => process.env.DASHSCOPE_API_KEY ?? '';

export const MODELS = {
  brain: process.env.MODEL_BRAIN ?? 'qwen-plus-character',
  memory: process.env.MODEL_MEMORY ?? 'qwen-plus-character',
  router: process.env.MODEL_ROUTER ?? 'qwen-flash-character',
  embed: process.env.MODEL_EMBED ?? 'qwen3.7-text-embedding',
};

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

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model ?? MODELS.brain,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 400,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`qwen chat ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
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

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${BASE}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.embed, input: text.slice(0, 6000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`qwen embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const v = data.data?.[0]?.embedding;
  if (!v || v.length !== 1024) throw new Error(`unexpected embedding size ${v?.length}`);
  return v;
}
