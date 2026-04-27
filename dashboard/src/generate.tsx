import { Page } from './components/index.js';
import { config } from './config.js';
import { fetchCIRuns, fetchIssues, fetchPRs } from './github.js';
import { computePage, parseIssues, parsePRs } from './transform.js';
import { transformSync } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', config.outputDir);

/** e.g. 'aws/agentcore-cli' → 'agentcore-cli' */
function repoSlug(repo: string): string {
  return repo.split('/')[1];
}

/** e.g. ('aws/agentcore-cli', 'issues') → 'agentcore-cli-issues' */
function pageFile(repo: string, pageId: string): string {
  return `${repoSlug(repo)}-${pageId}`;
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  // Copy chart.js and charts.js
  const chartSrc = join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  copyFileSync(chartSrc, join(outDir, 'chart.js'));

  const chartsClientSrc = join(__dirname, '..', 'src', 'charts.ts');
  const chartsTs = readFileSync(chartsClientSrc, 'utf-8').replace(/\/\* @strip \*\/[\s\S]*?\/\* @strip \*\/\n?/g, '');
  const chartsClient = transformSync(chartsTs, { loader: 'ts', target: 'es2020' }).code;
  writeFileSync(join(outDir, 'charts.js'), chartsClient);

  for (const repo of config.repos) {
    console.error(`\n── ${repo} ──`);

    const rawIssues = fetchIssues(repo);
    const issues = parseIssues(rawIssues);

    const rawPRs = fetchPRs(repo);
    const prs = parsePRs(rawPRs);

    const ciPage = config.pages.find(p => p.dataSource === 'ci');
    const ciSection = ciPage?.sections.find(s => s.type === 'ci');
    const ciRuns = ciSection
      ? fetchCIRuns(repo, ciSection.workflows, ciSection.branch, ciSection.maxRuns)
      : undefined;

    for (const page of config.pages) {
      const data = computePage(page, issues, prs, ciRuns);
      const file = pageFile(repo, page.id);
      const markup = String(<Page page={data} config={config} currentRepo={repo} currentPageId={page.id} />);
      const html = `<!DOCTYPE html><html lang="en">${markup}</html>`;
      const outPath = join(outDir, `${file}.html`);
      writeFileSync(outPath, html);
      console.error(`  → ${outPath}`);
    }
  }

  // Index redirect to first repo's first page
  const firstFile = pageFile(config.repos[0], config.pages[0].id);
  writeFileSync(
    join(outDir, 'index.html'),
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${firstFile}.html"></head></html>`
  );
  console.error(`  → ${join(outDir, 'index.html')}`);
  console.error('Done!');
}

main();
