import type { ContextStats, RepoContext, RepoFile, RepoMeta } from './types';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  cjs: 'JavaScript', py: 'Python', go: 'Go', rb: 'Ruby', java: 'Java', cs: 'C#', rs: 'Rust',
  kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', php: 'PHP', c: 'C', h: 'C', cpp: 'C++',
  cc: 'C++', hpp: 'C++', scala: 'Scala', sh: 'Shell', bash: 'Shell', sql: 'SQL', html: 'HTML',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS', vue: 'Vue', svelte: 'Svelte', dart: 'Dart',
  ex: 'Elixir', exs: 'Elixir', hs: 'Haskell', lua: 'Lua', r: 'R', jl: 'Julia', pl: 'Perl',
  m: 'Objective-C', mm: 'Objective-C', gradle: 'Gradle', tf: 'HCL', hcl: 'HCL', proto: 'Protobuf',
  graphql: 'GraphQL', gql: 'GraphQL', md: 'Markdown', mdx: 'Markdown', json: 'JSON',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML', astro: 'Astro',
};

/**
 * Language mix derived from the file tree instead of the GitHub /languages endpoint. That endpoint
 * costs one of the 60 unauthenticated API calls per hour, and the tree already tells us what we
 * need. Values are file counts, not bytes, and the prompt says so.
 */
function languagesFromTree(paths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of paths) {
    const base = path.split('/').pop() ?? '';
    const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
    const language = LANGUAGE_BY_EXT[ext];
    if (language) counts[language] = (counts[language] ?? 0) + 1;
  }
  return counts;
}

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', 'vendor',
  'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'obj', '.gradle',
  '.terraform', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'site-packages',
  'Pods', 'DerivedData', '.cache', '.turbo', 'third_party', 'testdata',
]);

const EXCLUDED_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|bun\.lockb?|\.DS_Store)$|\.min\.(js|css)$|\.(map|snap|lock)$/i;

const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rb', 'php', 'java', 'cs',
  'rs', 'kt', 'kts', 'swift', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm',
  'sql', 'sh', 'bash', 'zsh', 'ps1', 'md', 'mdx', 'rst', 'txt', 'json', 'jsonc',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'env', 'example', 'graphql', 'gql',
  'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'proto',
  'dockerfile', 'tf', 'hcl', 'gradle', 'properties', 'xml', 'csv',
]);

const MANIFESTS = new Set([
  'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json', 'Gemfile', 'mix.exs', 'pubspec.yaml', 'build.sbt',
  'tsconfig.json', 'jsconfig.json',
]);

const ENTRY_RE = /(^|\/)(main|index|app|server|cli|run|manage|wsgi|asgi|start|Program|Application|bootstrap|worker|handler)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|cs|rs|kt)$/;

/** Tests and fixtures are useful evidence but they explain far less about architecture than source. */
const TEST_PATH_RE =
  /(^|\/)(tests?|__tests__|spec|specs|test-d|e2e|fixtures?|__fixtures__|mocks?|__mocks__|examples?|samples?)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[a-z0-9]+$/i;

/** Directories that usually hold the actual product code. */
const CORE_DIR_RE = /^(src|source|lib|libs|app|apps|packages|core|internal|server|client|api|modules)\//i;

function isTestPath(path: string): boolean {
  return TEST_PATH_RE.test(path) || TEST_FILE_RE.test(path);
}

const PER_FILE_CHARS = 6000;
const TOTAL_CONTEXT_CHARS = 62_000;
const MAX_TREE_PATHS = 320;

export class RepoError extends Error {}

export type ParsedRepo = { owner: string; repo: string; branch?: string; subPath?: string };

export function parseRepoInput(input: string): ParsedRepo {
  const value = (input || '').trim();
  if (!value) throw new RepoError('Please paste a GitHub repository URL or "owner/repo".');

  let owner = '';
  let repo = '';
  let branch: string | undefined;
  let subPath: string | undefined;

  const urlMatch = value.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/([^\s#?]*))?)?/i,
  );

  if (urlMatch) {
    owner = urlMatch[1];
    repo = urlMatch[2];
    branch = urlMatch[3];
    subPath = urlMatch[4];
  } else {
    const short = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!short) {
      throw new RepoError(
        'That does not look like a GitHub repository. Try https://github.com/owner/repo or owner/repo.',
      );
    }
    owner = short[1];
    repo = short[2];
  }

  repo = repo.replace(/\.git$/i, '');
  if (!owner || !repo) throw new RepoError('Could not read the owner and repository name from that input.');
  return { owner, repo, branch, subPath };
}

function apiHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'OnboardPilot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function ghJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: apiHeaders(),
    cache: 'no-store',
  });
  if (response.status === 404) {
    throw new RepoError('Repository not found. Make sure it is public and the owner/name are correct.');
  }
  if (response.status === 403) {
    throw new RepoError(
      'GitHub API rate limit reached. Add a GITHUB_TOKEN environment variable (a free read-only token is enough) and retry.',
    );
  }
  if (!response.ok) {
    throw new RepoError(`GitHub API error ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

function isExcludedPath(path: string): boolean {
  if (EXCLUDED_FILE.test(path)) return true;
  const segments = path.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (EXCLUDED_DIRS.has(segment)) return true;
  }
  const base = segments[segments.length - 1];
  if (
    base.startsWith('.') &&
    !/^\.(github|gitignore|bobignore|env\.example|eslintrc|nvmrc|editorconfig)/i.test(base)
  ) {
    return true;
  }
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : base.toLowerCase();
  if (base.includes('.') && !TEXT_EXT.has(ext)) return true;
  return false;
}

function depthOf(path: string): number {
  return path.split('/').length;
}

/** Ranks files so the most onboarding-relevant ones are read first. */
function scoreFile(path: string, docCount: number, entryCount: number): number {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  const depth = depthOf(path);
  let score = 100 - depth * 6;

  if (/^readme/.test(base)) return 1000;
  if (base === 'contributing.md' || base === 'architecture.md') return 950;
  if (CORE_DIR_RE.test(path)) score += 150;
  if (isTestPath(path)) score -= 230;
  if (lower.startsWith('docs/') || lower.includes('/docs/')) score += docCount < 4 ? 400 : 120;
  if (MANIFESTS.has(base)) score += 320;
  if (ENTRY_RE.test(path)) score += entryCount < 8 ? 300 : 90;
  if (/(^|\/)(dockerfile|docker-compose\.ya?ml|makefile)$/i.test(path)) score += 220;
  if (/next\.config|vite\.config|webpack\.config|nest-cli|angular\.json/i.test(base)) score += 200;
  if (/\.github\/workflows\//.test(lower)) score += 160;
  if (/\.(tsx|jsx)$/.test(base)) score += 30;
  if (/(schema|model|types?|api|route|service|controller|store|config)\.(ts|tsx|js|jsx|py|go|java|rb)$/.test(base)) score += 60;
  if (depth <= 2) score += 40;
  return score;
}

async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  charCap: number = PER_FILE_CHARS,
): Promise<RepoFile | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `${RAW}/${owner}/${repo}/${encodeURIComponent(branch)}/${encoded}`;

  // One retry: raw.githubusercontent occasionally throttles under bursts, and a missing file only
  // degrades the report — but a burst of them degrades it badly.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OnboardPilot' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!response.ok) {
        if (response.status === 404) return null;
        continue;
      }
      const text = await response.text();
      const truncated = text.length > charCap;
      // For oversized files keep the head and the tail: the top of a module usually declares its
      // dependencies and public surface, while the bottom holds the exports and wiring.
      const content = truncated
        ? `${text.slice(0, Math.floor(charCap * 0.68))}\n\n… [${text.length - charCap} characters omitted] …\n\n${text.slice(-Math.floor(charCap * 0.32))}`
        : text;
      return { path, content, truncated, bytes: text.length };
    } catch {
      // fall through to the retry
    }
  }
  return null;
}

function summariseTree(tree: string[]) {
  const topLevelCounts = new Map<string, number>();
  for (const path of tree) {
    const top = path.includes('/') ? path.split('/')[0] : '(root files)';
    topLevelCounts.set(top, (topLevelCounts.get(top) ?? 0) + 1);
  }
  const topLevelDirs = [...topLevelCounts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files);
  return topLevelDirs;
}

export async function loadRepoContext(input: string): Promise<RepoContext> {
  const { owner, repo, branch: requestedBranch, subPath } = parseRepoInput(input);

  const meta = await ghJson<{
    full_name: string;
    name: string;
    owner: { login: string };
    description: string | null;
    default_branch: string;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    license: { spdx_id?: string; name?: string } | null;
    topics?: string[];
    pushed_at: string | null;
    html_url: string;
    size: number;
  }>(`/repos/${owner}/${repo}`);

  const branch = requestedBranch || meta.default_branch;

  // Two API calls per analysis: repository metadata and the recursive tree. The language mix is
  // derived locally so we do not spend a third call against the shared rate limit.
  const treePayload = await ghJson<{ tree: { path: string; type: string }[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );

  const rawPaths = treePayload.tree
    .filter((node) => node.type === 'blob')
    .map((node) => node.path);

  const scopePrefix = subPath ? `${subPath.replace(/\/$/, '')}/` : '';
  const scoped = scopePrefix ? rawPaths.filter((p) => p.startsWith(scopePrefix)) : rawPaths;

  const usable = scoped.filter((path) => !isExcludedPath(path));

  const docCount = usable.filter((p) => /(^|\/)(readme|docs?\/)/i.test(p)).length;
  const entryCount = usable.filter((p) => ENTRY_RE.test(p)).length;
  const finalRanked = [...usable]
    .map((path) => ({ path, score: scoreFile(path, docCount, entryCount) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.path);

  const docsFound = usable.filter((p) => /(^|\/)(readme|contributing|architecture|changelog)|^docs?\//i.test(p));
  const testFiles = usable.filter((p) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./i.test(p));
  const manifestsFound = usable.filter((p) => MANIFESTS.has(p.split('/').pop()!.toLowerCase()) || /dockerfile|docker-compose\.ya?ml|makefile$/i.test(p));
  const entryCandidates = usable.filter((p) => ENTRY_RE.test(p));

  const selected: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (path: string) => {
    if (!seen.has(path) && usable.includes(path)) {
      seen.add(path);
      selected.push(path);
    }
  };

  const sourceRanked = finalRanked.filter((path) => !isTestPath(path));
  const testRanked = finalRanked.filter((path) => isTestPath(path));

  // Source, docs, manifests and entry points first — tests only fill the remaining budget,
  // because tests are evidence of behaviour rather than evidence of architecture.
  sourceRanked.slice(0, 32).forEach(pushUnique);
  docsFound.slice(0, 6).forEach(pushUnique);
  manifestsFound.slice(0, 8).forEach(pushUnique);
  entryCandidates.filter((path) => !isTestPath(path)).slice(0, 10).forEach(pushUnique);
  for (const path of sourceRanked) {
    if (selected.length >= 42) break;
    pushUnique(path);
  }
  testRanked.slice(0, 4).forEach(pushUnique);
  for (const path of finalRanked) {
    if (selected.length >= 48) break;
    pushUnique(path);
  }

  const keyFiles: RepoFile[] = [];
  let totalContextChars = 0;
  // Spread the context budget across the selected files instead of letting three huge files eat it
  // all: on a large repository, coverage matters more than depth on any single file.
  const perFileCap = Math.min(
    PER_FILE_CHARS,
    Math.max(1800, Math.floor(TOTAL_CONTEXT_CHARS / Math.max(1, selected.length))),
  );
  const batchSize = 8;
  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((path) => fetchRawFile(owner, repo, branch, path, perFileCap)),
    );
    for (const file of results) {
      if (!file) continue;
      if (totalContextChars + file.content.length > TOTAL_CONTEXT_CHARS) continue;
      keyFiles.push(file);
      totalContextChars += file.content.length;
    }
    if (totalContextChars > TOTAL_CONTEXT_CHARS * 0.94) break;
  }

  if (keyFiles.length === 0) {
    throw new RepoError(
      'Could not read any text files from this repository. It may be empty, binary-only, or a private repository.',
    );
  }

  const readmeFile = keyFiles.find((file) => /(^|\/)readme(\.|$)/i.test(file.path));

  const repoMeta: RepoMeta = {
    owner: meta.owner?.login ?? owner,
    repo: meta.name ?? repo,
    fullName: meta.full_name ?? `${owner}/${repo}`,
    description: meta.description,
    defaultBranch: meta.default_branch ?? branch,
    primaryLanguage: meta.language,
    languages: languagesFromTree(usable),
    stars: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    openIssues: meta.open_issues_count ?? 0,
    license: meta.license?.spdx_id ?? meta.license?.name ?? null,
    topics: meta.topics ?? [],
    pushedAt: meta.pushed_at,
    htmlUrl: meta.html_url ?? `https://github.com/${owner}/${repo}`,
    sizeKb: meta.size ?? 0,
  };

  const tree = finalRanked.slice(0, MAX_TREE_PATHS);

  return {
    meta: repoMeta,
    tree,
    totalFilesInRepo: rawPaths.length,
    keyFiles,
    readme: readmeFile?.content ?? null,
    docsFound,
    testFiles,
    manifestsFound,
    entryCandidates,
    topLevelDirs: summariseTree(usable).slice(0, 14),
    totalContextChars,
  };
}

export function contextStats(context: RepoContext): ContextStats {
  const modules = context.topLevelDirs.filter((dir) => dir.name !== '(root files)').length;
  // A deliberately conservative heuristic for the manual ramp-up cost. It is logarithmic in file
  // count rather than linear — a 33,000-file monorepo does not cost 300x a 100-file library — and
  // it is capped so the number stays defensible instead of turning into a meaningless headline.
  const fileComponent = Math.min(60, Math.log2(context.totalFilesInRepo + 1) * 4);
  const moduleComponent = modules * 3.5;
  const testComponent = Math.min(12, context.testFiles.length * 0.1);
  const undocumentedPenalty = context.docsFound.length === 0 ? 8 : 0;
  const estimatedManualHours = Math.round(
    Math.min(
      160,
      Math.max(4, fileComponent + moduleComponent + testComponent + undocumentedPenalty),
    ),
  );
  return {
    filesInRepo: context.totalFilesInRepo,
    filesScanned: context.tree.length,
    filesRead: context.keyFiles.length,
    charsRead: context.totalContextChars,
    docsFound: context.docsFound.length,
    testFiles: context.testFiles.length,
    manifests: context.manifestsFound.length,
    estimatedManualHours,
  };
}
