// Shared domain types for OnboardPilot

export type RepoMeta = {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  primaryLanguage: string | null;
  languages: Record<string, number>;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  topics: string[];
  pushedAt: string | null;
  htmlUrl: string;
  sizeKb: number;
};

export type RepoFile = {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
};

export type RepoContext = {
  meta: RepoMeta;
  /** Every non-excluded path in the repository tree (capped by the caller). */
  tree: string[];
  totalFilesInRepo: number;
  /** Files we actually pulled the text of. */
  keyFiles: RepoFile[];
  readme: string | null;
  docsFound: string[];
  testFiles: string[];
  manifestsFound: string[];
  entryCandidates: string[];
  topLevelDirs: { name: string; files: number }[];
  totalContextChars: number;
};

export type Evidence = {
  path: string;
  note?: string | null;
  line?: number | null;
};

export type ArchitectureModule = {
  name: string;
  path: string;
  responsibility: string;
  keyFiles: string[];
};

export type ArchitectureLayer = {
  name: string;
  purpose: string;
  modules: ArchitectureModule[];
};

export type ArchitectureResult = {
  summary: string;
  stack: string[];
  layers: ArchitectureLayer[];
  flows: {
    name: string;
    steps: { label: string; detail: string; evidence?: string[] }[];
  }[];
  unknowns: string[];
  evidence: Evidence[];
};

export type EntryPoint = {
  name: string;
  kind: string;
  path: string;
  trigger: string;
  description: string;
};

export type EntryPointsResult = {
  summary: string;
  entryPoints: EntryPoint[];
  trace: {
    name: string;
    steps: { order: number; action: string; files: string[]; note: string }[];
  };
  evidence: Evidence[];
};

export type ConventionItem = {
  area: string;
  convention: string;
  evidence: string[];
};

export type RiskItem = {
  title: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
  evidence: string[];
};

export type ConventionsResult = {
  summary: string;
  conventions: ConventionItem[];
  testing: string;
  risks: RiskItem[];
  evidence: Evidence[];
};

export type FirstTask = {
  title: string;
  why: string;
  difficulty: 'starter' | 'intermediate' | 'advanced';
  files: string[];
  steps: string[];
  done: string[];
};

export type FirstTasksResult = {
  summary: string;
  tasks: FirstTask[];
  evidence: Evidence[];
};

export type OnboardingStep = {
  day: string;
  title: string;
  goal: string;
  actions: string[];
  checkpoint: string;
  files: string[];
};

export type OnboardingResult = {
  summary: string;
  steps: OnboardingStep[];
  questionsToAsk: string[];
  glossary: { term: string; meaning: string }[];
  evidence: Evidence[];
};

export type AgentId =
  | 'architecture'
  | 'entrypoints'
  | 'conventions'
  | 'firstTasks'
  | 'onboarding';

export type Report = {
  architecture?: ArchitectureResult;
  entrypoints?: EntryPointsResult;
  conventions?: ConventionsResult;
  firstTasks?: FirstTasksResult;
  onboarding?: OnboardingResult;
};

export type Usage = { prompt: number; completion: number };

export type AnalyzeEvent =
  | { type: 'stage'; stage: 'fetching' | 'reading' | 'analyzing'; message: string }
  | { type: 'context'; meta: RepoMeta; stats: ContextStats }
  | { type: 'agent'; id: AgentId; status: 'running' }
  | { type: 'agent'; id: AgentId; status: 'done'; ms: number; usage: Usage; data: unknown }
  | { type: 'agent'; id: AgentId; status: 'error'; ms: number; error: string }
  | { type: 'done'; totalMs: number; tokens: Usage }
  | { type: 'error'; error: string };

export type ContextStats = {
  filesInRepo: number;
  filesScanned: number;
  filesRead: number;
  charsRead: number;
  docsFound: number;
  testFiles: number;
  manifests: number;
  estimatedManualHours: number;
};
