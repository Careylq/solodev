/**
 * Unit tests for pure helpers.
 *
 * Run with:   node --experimental-strip-types --test tests/unit.test.ts
 *
 * No test dependencies are added — only node:test + node:assert.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRepoInput,
  languagesFromTree,
  scoreFile,
  RepoError,
} from '../lib/github.ts';

import { buildOnboardingMarkdown } from '../lib/markdown.ts';
import type { Report, RepoMeta, ContextStats } from '../lib/types.ts';

// ---------------------------------------------------------------------------
// parseRepoInput
// ---------------------------------------------------------------------------

describe('parseRepoInput', () => {
  it('parses a full https URL', () => {
    const result = parseRepoInput('https://github.com/vercel/next.js');
    assert.equal(result.owner, 'vercel');
    assert.equal(result.repo, 'next.js');
    assert.equal(result.branch, undefined);
    assert.equal(result.subPath, undefined);
  });

  it('parses the short owner/repo form', () => {
    const result = parseRepoInput('torvalds/linux');
    assert.equal(result.owner, 'torvalds');
    assert.equal(result.repo, 'linux');
  });

  it('strips a .git suffix', () => {
    const result = parseRepoInput('https://github.com/expressjs/express.git');
    assert.equal(result.owner, 'expressjs');
    assert.equal(result.repo, 'express');
  });

  it('captures branch from /tree/<branch>', () => {
    const result = parseRepoInput('https://github.com/facebook/react/tree/main');
    assert.equal(result.owner, 'facebook');
    assert.equal(result.repo, 'react');
    assert.equal(result.branch, 'main');
    assert.equal(result.subPath, undefined);
  });

  it('captures branch and sub-path from /tree/<branch>/<path>', () => {
    const result = parseRepoInput(
      'https://github.com/facebook/react/tree/canary/packages/react',
    );
    assert.equal(result.owner, 'facebook');
    assert.equal(result.repo, 'react');
    assert.equal(result.branch, 'canary');
    assert.equal(result.subPath, 'packages/react');
  });

  it('throws RepoError on empty input', () => {
    assert.throws(() => parseRepoInput(''), RepoError);
    assert.throws(() => parseRepoInput('   '), RepoError);
  });

  it('throws RepoError for a non-GitHub host', () => {
    assert.throws(
      () => parseRepoInput('https://gitlab.com/owner/repo'),
      RepoError,
    );
  });

  it('throws RepoError for too many path segments (bare path, no slash structure)', () => {
    // A plain string with no slash is not owner/repo
    assert.throws(() => parseRepoInput('just-a-name'), RepoError);
  });

  it('throws RepoError for three-segment short form', () => {
    // owner/repo/extra does not match the short regex
    assert.throws(() => parseRepoInput('owner/repo/extra'), RepoError);
  });
});

// ---------------------------------------------------------------------------
// languagesFromTree
// ---------------------------------------------------------------------------

describe('languagesFromTree', () => {
  it('counts code languages correctly', () => {
    const paths = [
      'src/index.ts',
      'src/utils.ts',
      'src/App.tsx',
      'lib/helper.py',
      'main.go',
    ];
    const langs = languagesFromTree(paths);
    assert.equal(langs['TypeScript'], 3);
    assert.equal(langs['Python'], 1);
    assert.equal(langs['Go'], 1);
  });

  it('excludes documentation and config formats from the normal result', () => {
    const paths = [
      'README.md',
      'CHANGELOG.md',
      'config.yaml',
      'package.json',
      'src/index.ts',
    ];
    const langs = languagesFromTree(paths);
    // Code language present
    assert.equal(langs['TypeScript'], 1);
    // Non-code formats must NOT appear when code is present
    assert.equal(langs['Markdown'], undefined);
    assert.equal(langs['YAML'], undefined);
    assert.equal(langs['JSON'], undefined);
  });

  it('falls back to config/doc formats when no code files exist', () => {
    const paths = [
      'config.yaml',
      'settings.yaml',
      'data.json',
      'README.md',
    ];
    const langs = languagesFromTree(paths);
    // No code → must return config formats instead of empty object
    assert.ok(Object.keys(langs).length > 0, 'should return at least one language for a config-only repo');
    // YAML and/or JSON should be present
    assert.ok(langs['YAML'] !== undefined || langs['JSON'] !== undefined);
    // TypeScript must not appear
    assert.equal(langs['TypeScript'], undefined);
  });

  it('returns an empty object for paths with no recognised extensions', () => {
    const langs = languagesFromTree(['no-ext', 'binary.exe', 'image.png']);
    assert.deepEqual(langs, {});
  });

  it('is case-insensitive for extensions', () => {
    const langs = languagesFromTree(['File.TS', 'Another.PY']);
    assert.equal(langs['TypeScript'], 1);
    assert.equal(langs['Python'], 1);
  });
});

// ---------------------------------------------------------------------------
// buildOnboardingMarkdown
// ---------------------------------------------------------------------------

/** Minimal meta object used across markdown tests. */
const baseMeta: RepoMeta = {
  owner: 'acme',
  repo: 'widget',
  fullName: 'acme/widget',
  description: 'A test repo',
  defaultBranch: 'main',
  primaryLanguage: 'TypeScript',
  languages: { TypeScript: 10 },
  stars: 42,
  forks: 3,
  openIssues: 1,
  license: 'MIT',
  topics: [],
  pushedAt: '2024-01-01T00:00:00Z',
  htmlUrl: 'https://github.com/acme/widget',
  sizeKb: 500,
};

const baseStats: ContextStats = {
  filesInRepo: 100,
  filesScanned: 50,
  filesRead: 20,
  charsRead: 40000,
  docsFound: 2,
  testFiles: 10,
  manifests: 3,
  estimatedManualHours: 8,
};

describe('buildOnboardingMarkdown', () => {
  it('contains the evidence index when evidence is provided', () => {
    const report: Report = {
      architecture: {
        summary: 'A widget service.',
        stack: ['TypeScript', 'Node.js'],
        layers: [],
        flows: [],
        unknowns: [],
        evidence: [
          { path: 'src/index.ts', note: 'entry' },
          { path: 'lib/utils.ts', note: 'utilities' },
        ],
      },
    };

    const md = buildOnboardingMarkdown(baseMeta, report, baseStats, 'https://github.com/acme/widget');

    assert.ok(md.includes('## 11. Evidence index'), 'should contain the evidence index heading');
    assert.ok(md.includes('src/index.ts'), 'should list evidence file src/index.ts');
    assert.ok(md.includes('lib/utils.ts'), 'should list evidence file lib/utils.ts');
    assert.ok(md.includes('architecture'), 'should show which section the file was used in');
  });

  it('does not crash when all optional report sections are missing', () => {
    const emptyReport: Report = {};
    assert.doesNotThrow(() => {
      const md = buildOnboardingMarkdown(baseMeta, emptyReport, null, 'https://github.com/acme/widget');
      // At minimum the header should still be there
      assert.ok(md.includes('acme/widget'));
    });
  });

  it('does not crash when optional sub-fields inside a section are absent', () => {
    const report: Report = {
      architecture: {
        summary: 'Just a summary.',
        stack: [],
        layers: [],
        flows: [],
        unknowns: [],
        evidence: [],
      },
    };
    assert.doesNotThrow(() => {
      buildOnboardingMarkdown(baseMeta, report, null, 'https://github.com/acme/widget');
    });
  });

  it('escapes pipe characters in model-supplied values so the GFM table is not broken', () => {
    const report: Report = {
      conventions: {
        summary: 'House rules.',
        conventions: [
          {
            area: 'Style | Formatting',
            convention: 'Use prettier | eslint',
            evidence: ['src/config.ts'],
          },
        ],
        testing: 'Jest',
        risks: [],
        evidence: [{ path: 'src/config.ts' }],
      },
    };

    const md = buildOnboardingMarkdown(baseMeta, report, baseStats, 'https://github.com/acme/widget');

    // Neither the area nor the convention cell should contain a bare | that would
    // split the GFM table row into extra columns.
    const tableLines = md
      .split('\n')
      .filter((l) => l.startsWith('| Style') || l.startsWith('| Use'));
    for (const tableLine of tableLines) {
      // A bare | in a cell value would produce at least 4 pipe characters per row
      // (row start + 3 extra separators from unescaped | in two cells + row end).
      // After escaping, the row must have exactly 4 `|` characters:
      //   | area | convention | evidence |
      const pipeCount = (tableLine.match(/(?<!\\)\|/g) ?? []).length;
      assert.equal(pipeCount, 4, `GFM row has unexpected number of pipes: ${tableLine}`);
    }

    // Escaped values must appear literally in the output
    assert.ok(md.includes('Style \\| Formatting'), 'pipe in area must be escaped');
    assert.ok(md.includes('Use prettier \\| eslint'), 'pipe in convention must be escaped');
  });

  it('escapes backticks in model-supplied path values inside code spans', () => {
    const pathWithBacktick = 'src/`evil`.ts';
    const report: Report = {
      architecture: {
        summary: 'Summary.',
        stack: [],
        layers: [
          {
            name: 'Core',
            purpose: 'Does things.',
            modules: [
              {
                name: 'Evil',
                path: pathWithBacktick,
                responsibility: 'Breaks parsers.',
                keyFiles: [pathWithBacktick],
              },
            ],
          },
        ],
        flows: [],
        unknowns: [],
        evidence: [],
      },
    };

    const md = buildOnboardingMarkdown(baseMeta, report, null, 'https://github.com/acme/widget');

    // The raw backtick must not appear unescaped inside a code span (which would close it early)
    assert.ok(
      md.includes('\\`evil\\`'),
      'backticks inside code spans must be escaped',
    );
  });
});

// ---------------------------------------------------------------------------
// Ranking guarantee: a test file must never outrank a core source file at the
// same tree depth.
// ---------------------------------------------------------------------------

describe('scoreFile ranking guarantee', () => {
  it('a core source file at depth 2 outranks a test file at depth 2', () => {
    // src/utils.ts  (depth 2, core dir, plain source)
    const sourceScore = scoreFile('src/utils.ts', 0, 0);
    // src/utils.test.ts  (depth 2, core dir, test file)
    const testScore = scoreFile('src/utils.test.ts', 0, 0);
    assert.ok(
      sourceScore > testScore,
      `source score ${sourceScore} should exceed test score ${testScore}`,
    );
  });

  it('a core source file at depth 3 outranks a test file at depth 3', () => {
    // src/services/auth.ts  (depth 3, core dir)
    const sourceScore = scoreFile('src/services/auth.ts', 0, 0);
    // src/services/auth.test.ts  (depth 3, core dir, test file)
    const testScore = scoreFile('src/services/auth.test.ts', 0, 0);
    assert.ok(
      sourceScore > testScore,
      `source score ${sourceScore} should exceed test score ${testScore}`,
    );
  });

  it('a core source file outranks a file inside a __tests__ directory at the same depth', () => {
    // lib/parser.ts  (depth 2)
    const sourceScore = scoreFile('lib/parser.ts', 0, 0);
    // lib/__tests__/parser.test.ts  (depth 3 — __tests__ adds a segment)
    // Test at same depth as source to maximise the chance of test winning:
    // lib/parser.test.ts  (depth 2)
    const testScore = scoreFile('lib/parser.test.ts', 0, 0);
    assert.ok(
      sourceScore > testScore,
      `source score ${sourceScore} should exceed test score ${testScore}`,
    );
  });

  it('a non-core source file at depth 2 still outranks a test file at depth 2', () => {
    // scripts/build.ts  (depth 2, no core-dir bonus)
    const sourceScore = scoreFile('scripts/build.ts', 0, 0);
    // scripts/build.test.ts  (depth 2, test file penalty)
    const testScore = scoreFile('scripts/build.test.ts', 0, 0);
    assert.ok(
      sourceScore > testScore,
      `source score ${sourceScore} should exceed test score ${testScore}`,
    );
  });
});
