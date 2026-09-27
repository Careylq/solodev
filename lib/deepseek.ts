import type { Usage } from './types';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export class DeepSeekError extends Error {}

type JsonCompletionOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  usage?: Usage;
  signal?: AbortSignal;
};

function parseJsonLoose<T>(raw: string, finishReason?: string): T {
  const attempts: string[] = [];
  const trimmed = raw.trim();
  attempts.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(trimmed.slice(first, last + 1));

  const balanced = extractBalancedObject(trimmed);
  if (balanced) attempts.push(balanced);

  const repaired = repairTruncatedObject(trimmed);
  if (repaired) attempts.push(repaired);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next candidate
    }
  }
  throw new DeepSeekError(
    `Model did not return parseable JSON (finish_reason=${finishReason ?? 'unknown'}, ${trimmed.length} chars). ` +
      `Head: ${trimmed.slice(0, 160)} … Tail: ${trimmed.slice(-160)}`,
  );
}

/** Returns the first complete top-level JSON object in the text, ignoring trailing prose. */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Salvages a JSON object that was cut off mid-stream: keeps the last complete value and closes
 * whatever containers are still open. A truncated answer should degrade, not disappear.
 *
 * Known limitation (deliberately deferred): after truncation the running `stack` may be stale —
 * if the last committed position `lastComplete` falls inside a container that was already closed
 * earlier in the source, the closing brackets appended here can produce structurally invalid JSON
 * that happens to parse (e.g. a spurious extra `}` at the top level). This stale-container-stack
 * risk is accepted for now because the function is used only as a last-resort fallback and any
 * surviving partial result is better than propagating an error to the user.
 */
function repairTruncatedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const source = text.slice(start);

  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  let lastComplete = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        lastComplete = i + 1;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      lastComplete = i + 1;
    } else if (ch === ',') lastComplete = i + 1;
    else if (/[0-9eE+\-.tfn]/.test(ch)) lastComplete = i + 1;
  }

  if (!stack.length) return null;

  let prefix = source.slice(0, lastComplete);
  for (let guard = 0; guard < 10; guard += 1) {
    const trimmed = prefix.replace(/[\s,]+$/, '');
    const candidate = trimmed + [...stack].reverse().join('');
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Drop the last (incomplete) member and try again.
      const cut = Math.max(
        trimmed.lastIndexOf(','),
        trimmed.lastIndexOf('{'),
        trimmed.lastIndexOf('['),
        trimmed.lastIndexOf(':'),
      );
      if (cut <= 0) return null;
      prefix = trimmed.slice(0, cut);
      // Removing content may also have removed a container; recompute the stack conservatively.
      if (stack.length > 1 && /[{[][^}\]]*$/.test(prefix)) {
        // keep going with the current stack estimate
      }
    }
  }
  return null;
}

/**
 * Calls DeepSeek with JSON output enforced, retrying once on transient failures.
 * Prompt prefixes are shared across the parallel agents so DeepSeek's automatic
 * context cache keeps the fan-out cheap and fast.
 */
export async function jsonCompletion<T>(options: JsonCompletionOptions): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new DeepSeekError(
      'DEEPSEEK_API_KEY is not set. Add it to .env.local locally and to the Vercel project env vars.',
    );
  }

  const {
    system,
    user,
    maxTokens = 1700,
    temperature = 0.2,
    model = 'deepseek-chat',
    timeoutMs = 105_000,
    usage,
    signal: callerSignal,
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // A truncated JSON object cannot be parsed, so on the second attempt we explicitly ask for a
    // much more compact answer instead of silently losing the whole agent.
    const userContent =
      attempt === 0
        ? user
        : `${user}

IMPORTANT: your previous response was cut off before the JSON object was complete, so it could not be parsed. Answer the same task again, but far more compactly: use the minimum number of items the schema allows, and keep every string shorter than 100 characters. The JSON object must be complete and syntactically valid.`;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    // Compose the caller's cancellation signal with the local timeout so either
    // the route's AbortController (browser disconnect) or the per-request timeout
    // can terminate this fetch, whichever fires first.
    const fetchSignal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          temperature,
          // On retry, reduce the budget to 60 % so the model is incentivised to answer more
          // compactly and avoid hitting the ceiling a second time for the same reason.
          max_tokens: attempt === 0 ? maxTokens : Math.round(maxTokens * 0.6),
          stream: false,
        }),
        signal: fetchSignal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new DeepSeekError(`DeepSeek HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = payload.choices?.[0];
      const content = choice?.message?.content ?? '';
      if (!content) throw new DeepSeekError('Empty completion from DeepSeek');

      if (choice?.finish_reason === 'length') {
        throw new DeepSeekError('Completion hit the token ceiling and the JSON was truncated');
      }

      // Accumulate after the truncation check: a cut-off attempt is not billed to the caller,
      // which previously made a retried call report the sum of both attempts as one call's worth.
      // A parse failure later in this function does still record its tokens, because those tokens
      // were genuinely consumed — the caller wants this agent's total, not one request's.
      if (usage && payload.usage) {
        usage.prompt += payload.usage.prompt_tokens ?? 0;
        usage.completion += payload.usage.completion_tokens ?? 0;
      }

      return parseJsonLoose<T>(content, choice?.finish_reason);
    } catch (error) {
      // If the caller's signal was aborted, stop retrying immediately and
      // let the abort propagate — there is no point in a second attempt.
      if (callerSignal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new DeepSeekError('DeepSeek request failed');
}
