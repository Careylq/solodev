/**
 * Smoke test for the repository context layer.
 *
 * Runs the whole context-assembly pipeline — tree fetch, filtering, ranking and file reads —
 * without spending a single model token. Useful while iterating on ranking heuristics.
 *
 *   npm run smoke -- expressjs/express
 */
import { contextStats, loadRepoContext, parseRepoInput } from '../lib/github.ts';

async function main() {
  const input = process.argv[2] ?? 'expressjs/express';

  console.log('parseRepoInput:', parseRepoInput(input));

  const started = Date.now();
  const context = await loadRepoContext(input);
  const elapsed = Date.now() - started;

  const stats = contextStats(context);

  console.log('\n=== repository ===');
  console.log(`${context.meta.fullName} — ${context.meta.description ?? '(no description)'}`);
  console.log(`language=${context.meta.primaryLanguage} stars=${context.meta.stars}`);
  console.log(`languages=${Object.keys(context.meta.languages).join(', ')}`);

  console.log('\n=== context ===');
  console.log(`tracked files: ${context.totalFilesInRepo}`);
  console.log(`paths kept:    ${context.tree.length}`);
  console.log(`files read:    ${context.keyFiles.length}`);
  console.log(`context chars: ${context.totalContextChars}`);
  console.log(`elapsed:       ${elapsed} ms`);

  console.log('\n=== stats surfaced to the UI ===');
  console.table(stats);

  console.log('\n=== top-level directories ===');
  console.table(context.topLevelDirs);

  console.log('\n=== files read (ranked) ===');
  for (const file of context.keyFiles) {
    console.log(`  ${file.path}  (${file.bytes} bytes${file.truncated ? ', truncated' : ''})`);
  }

  const ranked = context.keyFiles[0]?.path;
  if (!ranked) {
    console.error('\nFAIL: no files were read');
    process.exit(1);
  }
  console.log(`\nOK: context assembled, highest-ranked file is ${ranked}`);
}

main().catch((error) => {
  console.error('\nFAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
