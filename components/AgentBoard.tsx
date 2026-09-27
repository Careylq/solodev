'use client';

import { AGENT_META } from '@/lib/agentMeta';
import type { AgentId, Usage } from '@/lib/types';

export type AgentState = 'queued' | 'running' | 'done' | 'error';

export type AgentStatus = {
  state: AgentState;
  ms?: number;
  usage?: Usage;
  error?: string;
  tokens?: number;
};

type Props = {
  statuses: Partial<Record<AgentId, AgentStatus>>;
  onRetry?: (id: AgentId) => void;
};

const STATE_LABEL: Record<AgentState, string> = {
  queued: 'Queued',
  running: 'Working…',
  done: 'Complete',
  error: 'Failed',
};

function StateDot({ state, accent }: { state: AgentState; accent: string }) {
  if (state === 'running') {
    return (
      <span
        className="pulse-ring inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: accent }}
      />
    );
  }
  const color =
    state === 'done' ? '#4ade80' : state === 'error' ? '#f87171' : 'rgba(255,255,255,0.25)';
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />;
}

export default function AgentBoard({ statuses, onRetry }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {AGENT_META.map((agent) => {
        const status = statuses[agent.id];
        const state: AgentState = status?.state ?? 'queued';
        const isRunning = state === 'running';
        const isError = state === 'error';
        return (
          <div
            key={agent.id}
            className="card rise p-4"
            style={{
              borderColor: isRunning
                ? `${agent.accent}88`
                : isError
                  ? 'rgba(248,113,113,0.45)'
                  : undefined,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StateDot state={state} accent={agent.accent} />
                <span
                  className="text-[0.68rem] font-semibold uppercase tracking-wider"
                  style={{ color: agent.accent }}
                >
                  {STATE_LABEL[state]}
                </span>
              </div>
              {typeof status?.ms === 'number' && state !== 'running' ? (
                <span className="font-mono text-[0.68rem] text-slate-400">
                  {(status.ms / 1000).toFixed(1)}s
                </span>
              ) : null}
            </div>

            <h3 className="mt-3 text-sm font-semibold text-white">{agent.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{agent.subtitle}</p>

            {isError ? (
              <div className="mt-3">
                <p className="line-clamp-3 font-mono text-[0.68rem] leading-relaxed text-red-300/80">
                  {status?.error}
                </p>
                {onRetry ? (
                  <button
                    type="button"
                    onClick={() => onRetry(agent.id)}
                    className="mt-2 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[0.68rem] font-semibold text-red-200 hover:bg-red-400/20"
                  >
                    Retry this agent
                  </button>
                ) : null}
              </div>
            ) : null}

            {state === 'done' && status?.usage ? (
              <p className="mt-3 font-mono text-[0.68rem] text-slate-500">
                {status.usage.completion.toLocaleString()} tokens out
              </p>
            ) : null}

            {isRunning ? (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full w-1/2 animate-pulse rounded-full"
                  style={{ backgroundColor: agent.accent }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
