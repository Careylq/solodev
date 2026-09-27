import { AGENTS, agentById, buildSystemPrompt, runAgent } from '@/lib/agents';
import { RepoError, contextStats, loadRepoContext } from '@/lib/github';
import type { AgentId, AnalyzeEvent, RepoContext, Usage } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type CacheEntry = { at: number; context: RepoContext };
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const contextCache = new Map<string, CacheEntry>();

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

  const repo = (body.repo ?? '').trim();
  if (!repo) return Response.json({ error: 'Missing "repo"' }, { status: 400 });

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
