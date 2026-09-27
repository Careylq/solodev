# OnboardPilot

**Understand any codebase before lunch.**

Paste a public GitHub repository URL. OnboardPilot runs five analyst agents in parallel against
the real source and returns an onboarding map — architecture, execution traces, house rules,
risk radar, three shippable first tasks and a seven-step ramp-up plan.

> **The difference:** every claim cites the file it came from, and every citation links straight
> to GitHub. No evidence, no claim. Agents are also required to declare what they could *not*
> determine, instead of inventing a plausible answer.

Built for the **IBM Bob 2.0 Hackathon** — *Create a solution that improves a specific developer
workflow.*

📊 [Pitch deck](docs/pitch-deck.pdf) · 🖼 [Cover image](docs/cover.png) · 🤖 [Bob session evidence](bob_sessions/)

---

## The problem

Developer onboarding is one of the most expensive workflows in software, and almost nobody
measures it. A new engineer joining an unfamiliar codebase typically faces:

- **Days of archaeology before the first commit.** Architecture lives in people's heads, in stale
  diagrams, or in a `README.md` that describes a version of the system from two years ago.
- **Knowledge that is expensive to transfer.** A senior engineer has to answer the same questions
  repeatedly: where does a request enter? what owns this state? why is this module like this?
- **A high cost of mistakes.** Newcomers touch the wrong files, duplicate existing utilities, and
  trip over undocumented conventions — errors that surface later as review rework.
- **Hallucinated answers from general-purpose assistants.** A generic chatbot asked "how does this
  codebase work?" produces confident text with no way to check it. That is worse than no answer,
  because the newcomer cannot tell the difference.

The measurable cost is time-to-first-meaningful-pull-request, plus the senior-engineer hours burned
while it happens.

## What OnboardPilot does

Given a repository, it assembles a bounded, ranked context from the real source — documentation,
manifests, entry points and shallow core modules, with build outputs, dependencies and binaries
excluded — and then fans that single shared context out to five specialist agents:

| Agent | Question it answers |
| --- | --- |
| **Architecture Mapper** | What is this system, and how is it layered? |
| **Entry-Point Detective** | How does execution actually start, and how does a request flow through it? |
| **Convention & Risk Radar** | What are the unwritten house rules, and where are the landmines? |
| **First-Task Generator** | What are three real contributions I can ship this week? |
| **Ramp-Up Planner** | What is the shortest verified path to my first merged pull request? |

The result is a report you can read in ten minutes and an `ONBOARDING.md` you can commit into the
repository so the next person does not have to ask.

## Why it is different

1. **Evidence-backed output.** Each agent must attach the real file paths behind its statements.
   The UI renders them as chips that open the exact file on GitHub, plus an evidence index at the
   end of the report.
2. **Admitted ignorance.** Every analysis carries an "honest gaps" section listing what the
   available source could not answer. Onboarding is about knowing what to ask, not only what to read.
3. **Checkpoints, not reading lists.** The ramp-up plan is seven steps, each with a self-verifiable
   checkpoint. "Read `src/core`" is not a checkpoint; "explain why the request goes through the
   middleware chain twice" is.
4. **One shared context, five perspectives.** The agents do not each invent their own facts — they
   reason over one identical, ranked snapshot of the repository, so their conclusions agree.
5. **Reusable artifact.** `ONBOARDING.md` is generated in the browser and can be committed next to
   the code, where the next newcomer will actually find it.

## How it works

```
GitHub repository
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 1. Context assembly                lib/github.ts         │
│    tree → filter build/binary/deps → rank by onboarding  │
│    value (docs, manifests, entry points, core modules)   │
│    → read the top files into one shared context          │
└──────────────────────────────────────────────────────────┘
      │  one identical system prompt (cache-friendly prefix)
      ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Parallel analyst fan-out         lib/agents.ts        │
│    architecture │ entrypoints │ conventions │            │
│    firstTasks   │ onboarding          (Promise.all)      │
└──────────────────────────────────────────────────────────┘
      │  Server-Sent Events, one event per agent
      ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Live UI                          components/          │
│    AgentBoard (per-agent status) → ReportView             │
│    → ONBOARDING.md export           lib/markdown.ts      │
└──────────────────────────────────────────────────────────┘
```

The whole pipeline streams to the browser: you watch the five agents work, and each report section
appears the moment its agent finishes rather than waiting for the slowest one.

## Tech stack

- **Next.js 16** (App Router) with **React 19** and **TypeScript**
- **Tailwind CSS v4**
- **DeepSeek** (`deepseek-chat`) for the analyst agents, called with JSON output enforced
- **GitHub REST API** for repository metadata and the file tree; raw file contents over
  `raw.githubusercontent.com`
- **Server-Sent Events** over a Next.js Route Handler for streaming
- Deployed on **Vercel**

## Run it locally

```bash
git clone https://github.com/Careylq/onboardpilot.git
cd onboardpilot
npm install
cp .env.example .env.local     # then add your DEEPSEEK_API_KEY
npm run dev                    # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | yes | Authenticates the five analyst agents |
| `GITHUB_TOKEN` | no | Raises the GitHub API rate limit from 60 to 5,000 requests/hour |

Both are read exclusively through `process.env`. Nothing is hardcoded, and `.env.local` is
gitignored. See [SECURITY.md](SECURITY.md).

## How IBM Bob 2.0 was used

Bob was the development partner for this project, not a code autocomplete. The task session
summaries for each workstream are committed under [`bob_sessions/`](bob_sessions/).

| Workstream | How Bob was used |
| --- | --- |
| Orientation and plan | Plan mode over `AGENTS.md`, the README and `lib/` to produce the hardening plan the rest of the work followed |
| Code review | The built-in Review workflow signed off `lib/github.ts` and `lib/agents.ts`: crafted URL parsing, unbounded reads, missing timeouts, prompt injection from repository content |
| Agent-mode hardening | Multi-file changes under an approved plan — ranking heuristics, a hard cap on how many test files enter the context, explicit guardrails against invented file paths |
| Streaming API | Error-path hardening in `app/api/analyze/route.ts`: client disconnect, close-exactly-once, per-agent isolation so one failure cannot abort the other four |
| Verification | Bob generated and ran unit tests for the pure helpers (`parseRepoInput`, the markdown export, the ranking guarantee) with Node's built-in test runner |
| Security audit | A security-auditor mode checked credential leakage, untrusted repository content and SSRF through user-supplied repository identifiers |
| Prompt red-teaming | Parallel subagents adversarially tested all five analyst prompt contracts for hallucinated file paths |
| Documentation | Bob generated the architecture diagrams used in the pitch deck from the actual source, and audited every claim in this README against the code |
| Compliance | Document understanding over the hackathon guide and submission rules to derive the deliverable checklist |

## Impact

For a repository the size of the examples shipped in the UI, OnboardPilot produces its map in under
a minute. The manual equivalent — reading the docs, tracing entry points, working out conventions
and finding a safe first task — is an estimate in the hours-to-days range, and the report is
regenerated in seconds whenever the code moves.

The honest framing: OnboardPilot does not replace a conversation with the team. It removes the
reading work *before* that conversation so the conversation starts at a much higher level — which
is exactly what the "questions only your team can answer" section is for.

## Compliance

- Original work created during the IBM Bob 2.0 Hackathon build window.
- Released under the [MIT License](LICENSE).
- No third-party credentials, customer data, personal information or social-media data are used.
- No IBM Cloud or DeepSeek credentials are stored in this repository; `.gitignore` and `.bobignore`
  are the official hackathon template versions.
- `bob_sessions/` contains the required IBM Bob task session summary screenshots.

## License

MIT — see [LICENSE](LICENSE).
