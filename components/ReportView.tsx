'use client';

import type { ContextStats, RepoMeta, Report } from '@/lib/types';

type Props = {
  meta: RepoMeta;
  report: Report;
  stats: ContextStats | null;
};

function blobUrl(meta: RepoMeta, path: string): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${meta.htmlUrl}/blob/${encodeURIComponent(meta.defaultBranch)}/${encoded}`;
}

function EvidenceLinks({ meta, paths }: { meta: RepoMeta; paths?: string[] }) {
  if (!paths?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {paths.filter(Boolean).map((path) => (
        <a
          key={path}
          href={blobUrl(meta, path)}
          target="_blank"
          rel="noopener noreferrer"
          className="evidence-chip"
          title={`Open ${path} on GitHub`}
        >
          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
            <path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 1v3h3l-3-3Z" />
          </svg>
          {path}
        </a>
      ))}
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  hint,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white sm:text-2xl">{title}</h2>
        {hint ? <p className="mt-1 max-w-3xl text-sm text-slate-400">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const SEVERITY: Record<string, { bg: string; border: string; text: string; label: string }> = {
  high: { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.45)', text: '#fca5a5', label: 'High' },
  medium: { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.42)', text: '#fcd34d', label: 'Medium' },
  low: { bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.38)', text: '#67e8f9', label: 'Low' },
};

export default function ReportView({ meta, report, stats }: Props) {
  const arch = report.architecture;
  const entries = report.entrypoints;
  const conv = report.conventions;
  const tasks = report.firstTasks;
  const plan = report.onboarding;

  const cited = new Set<string>();
  const addAll = (paths?: string[]) => paths?.forEach((path) => path && cited.add(path));
  arch?.evidence?.forEach((item) => addAll([item.path]));
  entries?.evidence?.forEach((item) => addAll([item.path]));
  conv?.evidence?.forEach((item) => addAll([item.path]));
  tasks?.evidence?.forEach((item) => addAll([item.path]));
  plan?.evidence?.forEach((item) => addAll([item.path]));

  return (
    <div className="space-y-14">
      {/* Impact strip */}
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Tracked files', value: stats.filesInRepo.toLocaleString() },
            { label: 'Files read', value: stats.filesRead.toLocaleString() },
            { label: 'Docs found', value: stats.docsFound.toLocaleString() },
            { label: 'Test files', value: stats.testFiles.toLocaleString() },
            { label: 'Manual ramp-up (est.)', value: `~${stats.estimatedManualHours} h`, accent: true },
          ].map((item) => (
            <div key={item.label} className="card p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400">
                {item.label}
              </p>
              <p
                className={`mt-1 font-mono text-2xl font-semibold ${item.accent ? 'text-emerald-300' : 'text-white'}`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {arch ? (
        <Section
          id="architecture"
          eyebrow="Architecture Mapper"
          title="What this codebase is"
          hint={arch.summary}
        >
          {arch.stack?.length ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {arch.stack.map((item) => (
                <span key={item} className="chip">
                  {item}
                </span>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {(arch.layers ?? []).map((layer) => (
              <div key={layer.name} className="card card-hover p-5">
                <h3 className="text-base font-semibold text-white">{layer.name}</h3>
                <p className="mt-1 text-xs text-slate-400">{layer.purpose}</p>
                <div className="mt-4 space-y-3">
                  {(layer.modules ?? []).map((mod) => (
                    <div
                      key={`${layer.name}-${mod.name}`}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-white">{mod.name}</span>
                        <span className="font-mono text-[0.66rem] text-slate-500">{mod.path}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">{mod.responsibility}</p>
                      <EvidenceLinks meta={meta} paths={mod.keyFiles} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {arch.flows?.length ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {arch.flows.map((flow) => (
                <div key={flow.name} className="card p-5">
                  <h3 className="text-sm font-semibold text-white">{flow.name}</h3>
                  <ol className="mt-4 space-y-4">
                    {(flow.steps ?? []).map((step, index) => (
                      <li key={`${flow.name}-${index}`} className="relative pl-8">
                        <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-400/15 font-mono text-[0.65rem] text-indigo-200">
                          {index + 1}
                        </span>
                        {index < (flow.steps?.length ?? 0) - 1 ? (
                          <span className="absolute left-[0.6rem] top-6 h-[calc(100%-0.5rem)] w-px bg-white/10" />
                        ) : null}
                        <p className="text-sm font-medium text-white">{step.label}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{step.detail}</p>
                        <EvidenceLinks meta={meta} paths={step.evidence} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : null}

          {arch.unknowns?.length ? (
            <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                Honest gaps — OnboardPilot refuses to guess
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
                {arch.unknowns.map((item) => (
                  <li key={item}>— {item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}

      {entries ? (
        <Section
          id="entrypoints"
          eyebrow="Entry-Point Detective"
          title="How execution actually starts"
          hint={entries.summary}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {(entries.entryPoints ?? []).map((entry) => (
                <div key={`${entry.path}-${entry.name}`} className="card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{entry.name}</h3>
                    <span className="chip">{entry.kind}</span>
                  </div>
                  <p className="mt-1 font-mono text-[0.7rem] text-slate-500">{entry.path}</p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{entry.description}</p>
                  <p className="mt-2 text-xs text-cyan-200/80">
                    <span className="font-semibold">Trigger:</span> {entry.trigger}
                  </p>
                  <EvidenceLinks meta={meta} paths={[entry.path]} />
                </div>
              ))}
            </div>

            {entries.trace ? (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-white">
                  End-to-end trace · {entries.trace.name}
                </h3>
                <ol className="mt-4 space-y-4">
                  {(entries.trace.steps ?? []).map((step, index) => (
                    <li key={`trace-${index}`} className="relative pl-8">
                      <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/15 font-mono text-[0.65rem] text-cyan-100">
                        {step.order}
                      </span>
                      {index < (entries.trace.steps?.length ?? 0) - 1 ? (
                        <span className="absolute left-[0.6rem] top-6 h-[calc(100%-0.5rem)] w-px bg-white/10" />
                      ) : null}
                      <p className="text-sm font-medium text-white">{step.action}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{step.note}</p>
                      <EvidenceLinks meta={meta} paths={step.files} />
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {conv ? (
        <Section
          id="conventions"
          eyebrow="Convention & Risk Radar"
          title="House rules and landmines"
          hint={conv.summary}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {(conv.conventions ?? []).map((item) => (
                <div key={`${item.area}-${item.convention}`} className="card p-4">
                  <span className="chip">{item.area}</span>
                  <p className="mt-2 text-sm leading-relaxed text-slate-200">{item.convention}</p>
                  <EvidenceLinks meta={meta} paths={item.evidence} />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Testing</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">{conv.testing}</p>
              </div>
              {(conv.risks ?? []).map((risk) => {
                const tone = SEVERITY[risk.severity] ?? SEVERITY.low;
                return (
                  <div
                    key={risk.title}
                    className="rounded-xl p-4"
                    style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-bold uppercase"
                        style={{ color: tone.text, border: `1px solid ${tone.border}` }}
                      >
                        {tone.label}
                      </span>
                      <h3 className="text-sm font-semibold text-white">{risk.title}</h3>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-200/90">{risk.detail}</p>
                    <EvidenceLinks meta={meta} paths={risk.evidence} />
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      ) : null}

      {tasks ? (
        <Section
          id="first-tasks"
          eyebrow="First-Task Generator"
          title="Your first three contributions"
          hint={tasks.summary}
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {(tasks.tasks ?? []).map((task, index) => (
              <div key={task.title} className="card card-hover flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xl font-bold text-white/15">0{index + 1}</span>
                  <span className="chip">{task.difficulty}</span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-white">{task.title}</h3>
                <p className="mt-1 text-xs italic leading-relaxed text-slate-400">{task.why}</p>
                <EvidenceLinks meta={meta} paths={task.files} />

                <p className="mt-4 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-500">
                  Steps
                </p>
                <ol className="mt-1 space-y-1 text-xs text-slate-300">
                  {(task.steps ?? []).map((step, stepIndex) => (
                    <li key={`${task.title}-step-${stepIndex}`} className="flex gap-2">
                      <span className="font-mono text-slate-500">{stepIndex + 1}.</span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>

                <p className="mt-4 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-500">
                  Done when
                </p>
                <ul className="mt-1 space-y-1 text-xs text-emerald-200/90">
                  {(task.done ?? []).map((criterion) => (
                    <li key={`${task.title}-done-${criterion}`} className="flex gap-2">
                      <span aria-hidden>✓</span>
                      <span className="leading-relaxed text-slate-300">{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {plan ? (
        <Section
          id="plan"
          eyebrow="Ramp-Up Planner"
          title="Seven steps to your first merged pull request"
          hint={plan.summary}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {(plan.steps ?? []).map((step, index) => (
                <div key={`${step.day}-${step.title}`} className="card p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-purple-400/40 bg-purple-400/15 font-mono text-xs text-purple-100">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-purple-300/80">
                        {step.day}
                      </p>
                      <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-slate-300">{step.goal}</p>
                  <ul className="mt-3 space-y-1 text-xs text-slate-300">
                    {(step.actions ?? []).map((action, actionIndex) => (
                      <li key={`${step.title}-action-${actionIndex}`} className="flex gap-2">
                        <span className="text-slate-500">•</span>
                        <span className="leading-relaxed">{action}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-emerald-300">
                      Checkpoint
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-100/90">{step.checkpoint}</p>
                  </div>
                  <EvidenceLinks meta={meta} paths={step.files} />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              {plan.questionsToAsk?.length ? (
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-white">
                    Questions only your team can answer
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {plan.questionsToAsk.map((question) => (
                      <li key={question} className="flex gap-2">
                        <span className="text-indigo-300">?</span>
                        <span className="leading-relaxed">{question}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.glossary?.length ? (
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-white">Project glossary</h3>
                  <dl className="mt-3 space-y-2">
                    {plan.glossary.map((term) => (
                      <div key={term.term} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3">
                        <dt className="font-mono text-xs text-indigo-200">{term.term}</dt>
                        <dd className="text-xs leading-relaxed text-slate-300">{term.meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        id="evidence"
        eyebrow="Traceability"
        title="Evidence index"
        hint={`${cited.size} repository files are cited across this report. Every claim above links back to the source it came from, so nothing has to be taken on faith.`}
      >
        <div className="card flex flex-wrap gap-1.5 p-5">
          {[...cited].sort().map((path) => (
            <a
              key={path}
              href={blobUrl(meta, path)}
              target="_blank"
              rel="noopener noreferrer"
              className="evidence-chip"
            >
              {path}
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
