import { AGENTS, agentById, buildSystemPrompt, runAgent } from '@/lib/agents';
import { RepoError, contextStats, loadRepoContext } from '@/lib/github';
import type { AgentId, AnalyzeEvent, RepoContext, Usage } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type CacheEntry = { at: number; context: RepoContext };
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const contextCache = new Map<string, CacheEntry>();

/**
 * Best-effort abuse guard. The deployed endpoint is public and runs on the project's own model
 * credentials, so a single visitor should not be able to drain them. Serverless instances do not
 * share memory, which makes this a per-instance limit rather than a global one — good enough to
 * stop casual abuse, and deliberately generous so judges and demos are never blocked.
 */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 25;
const rateBuckets = new Map<string, number[]>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'local';
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 500) {
    for (const [bucketKey, bucketHits] of rateBuckets) {
      if (bucketHits.every((at) => now - at >= RATE_LIMIT_WINDOW_MS)) rateBuckets.delete(bucketKey);
    }
  }
  return false;
}

async function getContext(repo: string): Promise<RepoContext> {
  const key = repo.trim().toLowerCase();
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.context;
  const context = await loadRepoContext(repo);
  contextCache.set(key, { at: Date.now(), context });
  if (contextCache.size > 12) {
    const oldest = [...contextCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) contextCache.delete(oldest[0]);
  }
  return context;
}

export async function POST(request: Request) {
  let body: { repo?: string; only?: AgentId };
  try {
    body = (await request.json()) as { repo?: string; only?: AgentId };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
  if (!repo) {
    return Response.json(
      { error: 'Missing or invalid "repo" field: expected a GitHub URL string.' },
      { status: 400 },
    );
  }
  if (repo.length > 300) return Response.json({ error: 'Repository identifier is too long' }, { status: 400 });

  if (isRateLimited(clientKey(request))) {
    return Response.json(
      { error: 'Too many analyses from this address. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  const only = body.only ? agentById(body.only) : undefined;
  if (body.only && !only) return Response.json({ error: `Unknown agent "${body.only}"` }, { status: 400 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AnalyzeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        send({ type: 'stage', stage: 'fetching', message: `Resolving ${repo} on GitHub…` });
        const context = await getContext(repo);
        send({ type: 'stage', stage: 'reading', message: `Reading ${context.keyFiles.length} key files…` });
        send({ type: 'context', meta: context.meta, stats: contextStats(context) });

        const systemPrompt = buildSystemPrompt(context);
        const agents = only ? [only] : AGENTS;
        const tokens: Usage = { prompt: 0, completion: 0 };

        send({
          type: 'stage',
          stage: 'analyzing',
          message: `Running ${agents.length} analyst agents in parallel…`,
        });

        await Promise.all(
          agents.map(async (agent) => {
            send({ type: 'agent', id: agent.id, status: 'running' });
            const agentStart = Date.now();
            const usage: Usage = { prompt: 0, completion: 0 };
            try {
              const data = await runAgent<unknown>(agent, context, systemPrompt, usage);
              tokens.prompt += usage.prompt;
              tokens.completion += usage.completion;
              send({
                type: 'agent',
                id: agent.id,
                status: 'done',
                ms: Date.now() - agentStart,
                usage,
                data,
              });
            } catch (error) {
              send({
                type: 'agent',
                id: agent.id,
                status: 'error',
                ms: Date.now() - agentStart,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }),
        );

        send({ type: 'done', totalMs: Date.now() - startedAt, tokens });
      } catch (error) {
        const message =
          error instanceof RepoError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unexpected error while analysing the repository';
        send({ type: 'error', error: message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
