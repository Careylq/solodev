'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgentBoard, { type AgentStatus } from '@/components/AgentBoard';
import ReportView from '@/components/ReportView';
import { AGENT_IDS, AGENT_META } from '@/lib/agentMeta';
import { buildOnboardingMarkdown } from '@/lib/markdown';
import type {
  AgentId,
  AnalyzeEvent,
  ContextStats,
  Report,
  RepoMeta,
  Usage,
} from '@/lib/types';

const EXAMPLES = [
  { label: 'expressjs/express', repo: 'https://github.com/expressjs/express' },
  { label: 'honojs/hono', repo: 'https://github.com/honojs/hono' },
  { label: 'sindresorhus/ky', repo: 'https://github.com/sindresorhus/ky' },
  { label: 'tiangolo/fastapi', repo: 'https://github.com/tiangolo/fastapi' },
];

const BOB_CAPABILITIES = [
  {
    title: 'Agent mode',
    body: 'Bob made real, multi-file changes under an approved plan: tightening the repository ranking heuristics in lib/github.ts, hardening the server-sent-events error paths, and adding the guardrails that stop test fixtures crowding out core source.',
  },
  {
    title: 'Parallel tasks & subagents',
    body: 'Bob fanned the five analyst prompt contracts out to isolated subagent contexts and red-teamed them in parallel, hunting for the input that would make a model cite a file path that does not exist.',
  },
  {
    title: 'Document understanding',
    body: 'Bob read the hackathon guide, challenge statement and submission rules and turned them into the compliance checklist this project was built against — then audited the README against the actual source and listed every claim that did not hold.',
  },
  {
    title: 'Code reviews',
    body: 'The built-in Review workflow analysed lib/github.ts and lib/agents.ts as a staff-engineer sign-off: crafted URL parsing, unbounded reads, missing timeouts and prompt injection from repository content. The findings were fixed, not filed.',
  },
  {
    title: 'Custom rules & .bobignore',
    body: 'Project rules pinned the "always cite a real file path" discipline and the code style; .bobignore kept credentials out of Bob session history from the first commit, and a security-auditor mode ran the credential and untrusted-input audit.',
  },
  {
    title: 'Task session summaries',
    body: 'Every Bob task that shaped this repository was captured as a task session consumption summary and committed under bob_sessions/ as required evidence.',
  },
];

type Stage = { stage: string; message: string } | null;

export default function Home() {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage>(null);
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [stats, setStats] = useState<ContextStats | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<AgentId, AgentStatus>>>({});
  const [report, setReport] = useState<Report>({});
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Usage | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [analyzedRepo, setAnalyzedRepo] = useState('');
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const hasReport = useMemo(() => Object.values(report).some((value) => Boolean(value)), [report]);

  const applyEvent = useCallback((event: AnalyzeEvent) => {
    switch (event.type) {
      case 'stage':
        setStage({ stage: event.stage, message: event.message });
        break;
      case 'context':
        setMeta(event.meta);
        setStats(event.stats);
        break;
      case 'agent':
        if (event.status === 'running') {
          setStatuses((prev) => ({ ...prev, [event.id]: { state: 'running' } }));
        } else if (event.status === 'done') {
          setStatuses((prev) => ({
            ...prev,
            [event.id]: { state: 'done', ms: event.ms, usage: event.usage },
          }));
          setReport((prev) => ({ ...prev, [event.id]: event.data }) as Report);
        } else {
          setStatuses((prev) => ({
            ...prev,
            [event.id]: { state: 'error', ms: event.ms, error: event.error },
          }));
        }
        break;
      case 'done':
        setTotalMs(event.totalMs);
        setTokens(event.tokens);
        break;
      case 'error':
        setError(event.error);
        break;
      default:
        break;
    }
  }, []);

  const analyze = useCallback(
    async (target: string, only?: AgentId) => {
      const repo = target.trim();
      if (!repo || running) return;

      setError(null);
      if (!only) {
        setReport({});
        setMeta(null);
        setStats(null);
        setTokens(null);
        setTotalMs(null);
        setAnalyzedRepo(repo);
        setStatuses(Object.fromEntries(AGENT_IDS.map((id) => [id, { state: 'queued' as const }])));
        setStage({ stage: 'fetching', message: 'Connecting to GitHub…' });
      } else {
        setStatuses((prev) => ({ ...prev, [only]: { state: 'running' } }));
      }

      setRunning(true);
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, only }),
        });

        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Analysis request failed (HTTP ${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            try {
              applyEvent(JSON.parse(dataLine.slice(5).trim()) as AnalyzeEvent);
            } catch {
              // ignore malformed frame
            }
          }
        }

        // If the stream closed without a final `done` event (server crash, timeout), any agent
        // still in `running` or `queued` would be stuck forever with no retry button. Move them
        // to `error` so the existing per-agent retry UI becomes available.
        setStatuses((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(next) as (keyof typeof next)[]) {
            const s = next[id];
            if (s?.state === 'running' || s?.state === 'queued') {
              next[id] = { state: 'error', error: 'Stream ended without a result' };
            }
          }
          return next;
        });

        if (!only) {
          window.setTimeout(
            () => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            120,
          );
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Something went wrong';
        setError(message);
        if (only) {
          setStatuses((prev) => ({ ...prev, [only]: { state: 'error', error: message } }));
        }
      } finally {
        setRunning(false);
        setStage(null);
      }
    },
    [applyEvent, running],
  );

  const saveBlob = useCallback((content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadMarkdown = useCallback(() => {
    if (!meta) return;
    saveBlob(
      buildOnboardingMarkdown(meta, report, stats, analyzedRepo),
      'ONBOARDING.md',
      'text/markdown;charset=utf-8',
    );
  }, [analyzedRepo, meta, report, saveBlob, stats]);

  const downloadJson = useCallback(() => {
    saveBlob(
      JSON.stringify({ meta, stats, report }, null, 2),
      'onboardpilot-report.json',
      'application/json',
    );
  }, [meta, report, saveBlob, stats]);

  // Deep link support: /?repo=owner/name runs the analysis immediately, so a report can be shared
  // as a URL and a demo does not need anyone to type. The work is deferred one tick so the
  // bootstrap does not cascade state updates synchronously inside the effect. Note: no cleanup
  // here on purpose — React StrictMode replays effects on mount, and cancelling the pending timer
  // would silently drop the deep link in development.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    const target = new URLSearchParams(window.location.search).get('repo');
    if (!target) return;
    window.setTimeout(() => {
      setInput(target);
      void analyze(target);
    }, 0);
  }, [analyze]);

  return (
    <main className="bg-grid min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070e]/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-black text-[#05070e]">
              O
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">OnboardPilot</span>
            <span className="hidden text-xs text-slate-500 lg:inline">
              understand any codebase before lunch
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {hasReport ? (
              <>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-lg border border-indigo-400/40 bg-indigo-400/10 px-3 py-1.5 font-semibold text-indigo-100 hover:bg-indigo-400/20"
                >
                  Download ONBOARDING.md
                </button>
                <button
                  type="button"
                  onClick={downloadJson}
                  className="hidden rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-slate-200 hover:bg-white/10 sm:block"
                >
                  JSON
                </button>
              </>
            ) : (
              <span className="hidden sm:inline">Built with IBM Bob 2.0</span>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-10 pt-14 sm:pt-20">
        <div className="max-w-3xl">
          <span className="chip">IBM Bob 2.0 Hackathon · developer onboarding workflow</span>
          <h1 className="mt-5 text-4xl font-black leading-[1.06] tracking-tight text-white sm:text-6xl">
            Understand any codebase
            <span className="bg-gradient-to-r from-indigo-300 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
              {' '}
              before lunch.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            New developers lose days — sometimes weeks — just working out how an unfamiliar system
            fits together. Paste a public GitHub repository and OnboardPilot runs five analyst agents
            in parallel to produce an onboarding map: architecture, execution traces, house rules,
            risk radar, three shippable first tasks and a seven-step ramp-up plan.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-indigo-200/90">
            The difference: <strong className="font-semibold">every single claim cites the file it
            came from</strong>. Click any citation and verify it on GitHub. No evidence, no claim.
          </p>
        </div>

        <form
          className="mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void analyze(input);
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            aria-label="GitHub repository URL"
            className="flex-1 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 font-mono text-sm text-white placeholder:text-slate-500 focus:border-indigo-400/70 focus:outline-none"
          />
          <button
            type="submit"
            disabled={running || !input.trim()}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-400 px-6 py-3 text-sm font-bold text-[#05070e] transition disabled:cursor-not-allowed disabled:opacity-45"
          >
            {running ? 'Analysing…' : 'Analyse repository'}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.repo}
              type="button"
              disabled={running}
              onClick={() => {
                setInput(example.repo);
                void analyze(example.repo);
              }}
              className="chip hover:border-indigo-400/60 hover:text-indigo-100 disabled:opacity-50"
            >
              {example.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-6 max-w-3xl rounded-xl border border-red-400/40 bg-red-400/10 p-4">
            <p className="text-sm font-semibold text-red-200">Analysis could not complete</p>
            <p className="mt-1 font-mono text-xs leading-relaxed text-red-200/80">{error}</p>
          </div>
        ) : null}
      </section>

      <div ref={resultsRef} />

      {running || Object.keys(statuses).length > 0 ? (
        <section className="mx-auto max-w-7xl px-5 pb-14">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Analyst pipeline
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {stage ? <span className="font-mono text-indigo-200">{stage.message}</span> : null}
              {totalMs ? (
                <span className="font-mono">
                  {(totalMs / 1000).toFixed(1)}s total
                  {tokens
                    ? ` · ${(tokens.prompt + tokens.completion).toLocaleString()} tokens`
                    : ''}
                </span>
              ) : null}
            </div>
          </div>
          <AgentBoard
            statuses={statuses}
            onRetry={(id) => {
              void analyze(analyzedRepo || input, id);
            }}
          />
        </section>
      ) : null}

      {meta ? (
        <section className="mx-auto max-w-7xl px-5 pb-10">
          <div className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={meta.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lg font-bold text-white hover:text-indigo-200"
                >
                  {meta.fullName}
                </a>
                <span className="chip">{meta.primaryLanguage ?? 'mixed'}</span>
                <span className="chip">★ {meta.stars.toLocaleString()}</span>
                <span className="chip">{meta.license ?? 'no license'}</span>
                <span className="chip">branch: {meta.defaultBranch}</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                {meta.description ?? 'No repository description provided.'}
              </p>
            </div>
            {hasReport ? (
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-lg border border-indigo-400/40 bg-indigo-400/10 px-3 py-2 font-semibold text-indigo-100 hover:bg-indigo-400/20"
                >
                  ONBOARDING.md
                </button>
                <button
                  type="button"
                  onClick={downloadJson}
                  className="rounded-lg border border-white/15 px-3 py-2 font-semibold text-slate-200 hover:bg-white/10"
                >
                  JSON
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {hasReport && meta ? (
        <section className="mx-auto max-w-7xl px-5 pb-20">
          <ReportView meta={meta} report={report} stats={stats} />
        </section>
      ) : null}

      <section className="border-t border-white/10 bg-black/20">
        <div className="mx-auto max-w-7xl px-5 py-16">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
            How it works
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            Five specialists, one shared context, zero invented file paths
          </h2>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Repository context assembly',
                body: 'OnboardPilot pulls the repository tree, ranks the files that actually explain a codebase (docs, manifests, entry points, shallow core modules), and reads them into a single shared context. Build outputs, dependencies and binaries are dropped.',
              },
              {
                step: '02',
                title: 'Parallel analyst fan-out',
                body: 'Five agents — Architecture Mapper, Entry-Point Detective, Convention & Risk Radar, First-Task Generator and Ramp-Up Planner — run concurrently against that same context, so they agree on the facts instead of inventing their own.',
              },
              {
                step: '03',
                title: 'Verification, not vibes',
                body: 'Every agent must attach the real file paths behind each statement, and declare what it could not determine. The report links each citation straight to GitHub and exports to an ONBOARDING.md you can commit.',
              },
            ].map((item) => (
              <div key={item.step} className="card p-6">
                <span className="font-mono text-2xl font-bold text-white/15">{item.step}</span>
                <h3 className="mt-2 text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-5 py-16">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
            Built with IBM Bob 2.0
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            Bob was the development partner, not a code autocomplete
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            OnboardPilot was designed, implemented, reviewed and hardened inside IBM Bob IDE. Task
            session summaries for each of these workstreams are committed under{' '}
            <code className="font-mono text-indigo-200">bob_sessions/</code>.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {BOB_CAPABILITIES.map((item) => (
              <div key={item.title} className="card card-hover p-5">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            OnboardPilot · built for the IBM Bob 2.0 Hackathon · five agents:{' '}
            {AGENT_META.map((agent) => agent.title).join(', ')}
          </span>
          <span>AI output is a starting map, not ground truth — verify before you trust.</span>
        </div>
      </footer>
    </main>
  );
}
