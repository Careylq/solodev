import { AGENT_META } from './agentMeta';
import { jsonCompletion } from './deepseek';
import type { AgentId, RepoContext, Usage } from './types';

const SHARED_RULES = `You are OnboardPilot, a senior staff engineer who helps a new developer become productive in an unfamiliar codebase.

GROUND RULES (never break these):
1. Every claim you make must be traceable to a file path that appears in the provided FILE TREE or FILE CONTENTS. Never invent, guess or extrapolate a path.
2. If the evidence does not exist in the provided material, say so explicitly in an "unknowns" field or omit the claim. Honest gaps beat confident fiction.
3. Prefer concrete, specific statements ("src/api/routes.ts wires the Express routers") over generic ones ("the project has a good structure").
4. Return a single valid JSON object. No markdown fences, no commentary before or after.
5. Be compact. Use the minimum number of items each schema allows and keep every string under 140 characters. A complete, valid JSON object matters far more than exhaustive detail — a truncated answer is a failed answer.`;

function treeSection(context: RepoContext): string {
  const lines: string[] = [];
  lines.push('TOP-LEVEL DIRECTORIES (by file count):');
  lines.push(context.topLevelDirs.map((dir) => `  - ${dir.name} (${dir.files} files)`).join('\n'));
  lines.push('');
  lines.push(
    `FILE TREE (${context.tree.length} of ${context.totalFilesInRepo} files; build, dependency and binary paths removed):`,
  );
  lines.push(context.tree.map((path) => `  ${path}`).join('\n'));
  lines.push('');
  lines.push(`DOCUMENTATION FILES: ${context.docsFound.slice(0, 20).join(', ') || 'none found'}`);
  lines.push(`TEST FILES: ${context.testFiles.slice(0, 30).join(', ') || 'none found'}`);
  lines.push(`MANIFESTS / BUILD FILES: ${context.manifestsFound.slice(0, 20).join(', ') || 'none found'}`);
  lines.push(`ENTRY-POINT CANDIDATES: ${context.entryCandidates.slice(0, 20).join(', ') || 'none found'}`);
  return lines.join('\n');
}

function fileSection(context: RepoContext): string {
  return context.keyFiles
    .map((file) => `=== ${file.path} (${file.bytes} bytes) ===\n${file.content}`)
    .join('\n\n');
}

export function buildSystemPrompt(context: RepoContext): string {
  const { meta } = context;
  const languages = Object.entries(meta.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, files]) => `${name} (${files} files)`)
    .join(', ');

  return `${SHARED_RULES}

=========================
REPOSITORY CONTEXT
=========================
Repository: ${meta.fullName}
Description: ${meta.description ?? '(none provided)'}
Primary language: ${meta.primaryLanguage ?? 'unknown'}
Code files by language (file counts, docs and config excluded): ${languages || 'unknown'}
Stars: ${meta.stars} | Forks: ${meta.forks} | Open issues: ${meta.openIssues}
License: ${meta.license ?? 'none declared'}
Default branch: ${meta.defaultBranch}
Repository size: ${meta.sizeKb} KB (${context.totalFilesInRepo} tracked files)
Topics: ${meta.topics.join(', ') || 'none'}

${treeSection(context)}

=========================
FILE CONTENTS (${context.keyFiles.length} files, ${context.totalContextChars} characters)
=========================
${fileSection(context)}
=========================
END OF REPOSITORY CONTEXT
=========================`;
}

export type AgentSpec = {
  id: AgentId;
  title: string;
  subtitle: string;
  accent: string;
  maxTokens: number;
  buildUser: (context: RepoContext) => string;
};

type PromptMap = Record<AgentId, { maxTokens: number; buildUser: () => string }>;

const PROMPTS: PromptMap = {
  architecture: {
    maxTokens: 3400,
    buildUser: () => `TASK: Map the architecture of this repository for a developer who has never seen it.

Group the code into 3 to 5 horizontal layers (for example: Entry / Interface, Domain or Core logic, Data or Integration, Platform or Tooling). For each layer list its modules.

Return JSON with exactly this shape:
{
  "summary": "3-4 sentences describing what this system actually does and how it is structured",
  "stack": ["framework or library", "..."],
  "layers": [
    {
      "name": "layer name",
      "purpose": "one sentence",
      "modules": [
        { "name": "module or directory name", "path": "real/path/from/tree", "responsibility": "one sentence", "keyFiles": ["real/path.ts"] }
      ]
    }
  ],
  "flows": [
    { "name": "name of an important runtime flow", "steps": [ { "label": "short step name", "detail": "what happens here", "evidence": ["real/path.ts"] } ] }
  ],
  "unknowns": ["things you could not determine from the provided files"],
  "evidence": [ { "path": "real/path", "note": "what this file proves" } ]
}

Rules: 3-4 layers, 2-4 modules per layer, exactly 1 flow with 4 to 6 steps. Keep every string under 140 characters.`,
  },
  entrypoints: {
    maxTokens: 2800,
    buildUser: () => `TASK: Find how this software actually starts and how a typical request or command travels through it.

Return JSON with exactly this shape:
{
  "summary": "2-3 sentences on how execution begins",
  "entryPoints": [
    { "name": "readable name", "kind": "http-server | cli | worker | scheduled-job | desktop | library-export | build-script", "path": "real/path", "trigger": "what starts it (command, route, event)", "description": "one sentence" }
  ],
  "trace": {
    "name": "the single most important end-to-end flow",
    "steps": [ { "order": 1, "action": "what happens", "files": ["real/path"], "note": "why this matters to a newcomer" } ]
  },
  "evidence": [ { "path": "real/path", "note": "what this file proves" } ]
}

Rules: list at most 6 entry points, ranked by importance. The trace must have 4 to 8 steps and must reference real files.`,
  },
  conventions: {
    maxTokens: 2800,
    buildUser: () => `TASK: Extract the unwritten house rules a newcomer must follow, and flag the risky areas that cause rework.

Return JSON with exactly this shape:
{
  "summary": "2-3 sentences",
  "conventions": [
    { "area": "area (e.g. naming, error handling, state, styling, commits, config)", "convention": "the rule to follow, stated as an instruction", "evidence": ["real/path"] }
  ],
  "testing": "one paragraph describing how tests are written, where they live and how to run them; say so plainly if tests are missing",
  "risks": [
    { "title": "short risk title", "severity": "high | medium | low", "detail": "why this costs a newcomer time or causes bugs", "evidence": ["real/path"] }
  ],
  "evidence": [ { "path": "real/path", "note": "what this file proves" } ]
}

Rules: 4 to 8 conventions, 3 to 6 risks. Be specific, never generic advice.`,
  },
  firstTasks: {
    maxTokens: 2400,
    buildUser: () => `TASK: Design three concrete starter tasks that would let a brand new contributor make a real, mergeable contribution.

A good starter task touches real files, is independently verifiable, and teaches something about the system.

Return JSON with exactly this shape:
{
  "summary": "2 sentences on how you chose these tasks",
  "tasks": [
    {
      "title": "the task, written as an action",
      "why": "why this is a good first contribution here",
      "difficulty": "starter | intermediate | advanced",
      "files": ["real/path.ts"],
      "steps": ["ordered implementation step", "..."],
      "done": ["an objectively checkable definition of done", "..."]
    }
  ],
  "evidence": [ { "path": "real/path", "note": "what this file proves" } ]
}

Rules: exactly 3 tasks, ordered easiest first. 3 to 6 steps and 2 to 4 done-criteria per task.`,
  },
  onboarding: {
    maxTokens: 3000,
    buildUser: () => `TASK: Produce a seven-step ramp-up plan that takes a new developer from zero to a first merged pull request.

Each step must have a checkpoint that proves the developer really understood it, not just read it.

Return JSON with exactly this shape:
{
  "summary": "2-3 sentences framing the plan and the total expected effort",
  "steps": [
    {
      "day": "Step 1",
      "title": "short title",
      "goal": "what the developer can do after this step",
      "actions": ["concrete action", "..."],
      "checkpoint": "a self-verifiable test of understanding",
      "files": ["real/path"]
    }
  ],
  "questionsToAsk": ["a question the newcomer should ask the team, because the code cannot answer it"],
  "glossary": [ { "term": "domain or project term", "meaning": "plain-language meaning" } ],
  "evidence": [ { "path": "real/path", "note": "what this file proves" } ]
}

Rules: exactly 7 steps. 3 to 5 actions per step. 4 to 6 questions. 5 to 8 glossary terms.`,
  },
};

function meta(id: AgentId): Omit<AgentSpec, 'buildUser'> {
  const found = AGENT_META.find((agent) => agent.id === id);
  if (!found) throw new Error(`Missing agent metadata for "${id}"`);
  return {
    id: found.id,
    title: found.title,
    subtitle: found.subtitle,
    accent: found.accent,
    maxTokens: PROMPTS[id].maxTokens,
  };
}

export const AGENTS: AgentSpec[] = (Object.keys(PROMPTS) as AgentId[]).map((id) => ({
  ...meta(id),
  buildUser: PROMPTS[id].buildUser,
}));

export function agentById(id: AgentId): AgentSpec | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export async function runAgent<T>(
  agent: AgentSpec,
  context: RepoContext,
  systemPrompt: string,
  usage: Usage,
  signal?: AbortSignal,
): Promise<T> {
  return jsonCompletion<T>({
    system: systemPrompt,
    user: agent.buildUser(context),
    maxTokens: agent.maxTokens,
    temperature: 0.2,
    usage,
    signal,
  });
}
