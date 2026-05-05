#!/usr/bin/env node

/**
 * Coverage gate for agentcore-cli PRs.
 *
 * 1. Reads the vitest json-summary coverage report for overall stats.
 * 2. Computes per-directory line coverage and fails if any directory is
 *    below its ratchet threshold.
 * 3. Reads the vitest json report for per-line data, then checks exactly
 *    which PR-changed lines are covered. Fails if < PR_LINES_THRESHOLD
 *    of changed production lines are covered.
 * 4. Posts a coverage summary comment on the PR (if running in GitHub Actions).
 *
 * Ratchet thresholds are set ~5% below current coverage to prevent
 * regression without demanding immediate improvement. Target thresholds
 * (noted next to each entry) represent what the directory *should*
 * eventually reach.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const PR_LINES_THRESHOLD = 50;

/**
 * Per-directory line coverage thresholds.
 * Entries are checked longest-prefix-first so that nested directories take
 * precedence over their parents.
 */
// Ratchet thresholds set ~5% below current to catch regressions without
// demanding immediate improvement. Raise when coverage improves.
const DIRECTORY_THRESHOLDS = [
  { prefix: 'src/schema/', threshold: 78, target: 85 },
  { prefix: 'src/cli/operations/', threshold: 52, target: 65 },
  { prefix: 'src/lib/', threshold: 82, target: 85 },
  { prefix: 'src/cli/aws/', threshold: 40, target: 60 },
  { prefix: 'src/cli/tui/hooks/', threshold: 14, target: 55 },
  { prefix: 'src/cli/tui/components/', threshold: 68, target: 75 },
  { prefix: 'src/cli/commands/', threshold: 34, target: 60 },
];

// ---------------------------------------------------------------------------
// 1. Read overall coverage from json-summary
// ---------------------------------------------------------------------------

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const overall = summary.total;

const stmtPct = overall.statements.pct;
const branchPct = overall.branches.pct;
const funcPct = overall.functions.pct;
const linePct = overall.lines.pct;

// ---------------------------------------------------------------------------
// 2. Compute per-directory coverage from json-summary
// ---------------------------------------------------------------------------

const cwd = process.cwd();
const dirStats = DIRECTORY_THRESHOLDS.map(d => ({ ...d, total: 0, covered: 0 }));

for (const [absPath, fileSummary] of Object.entries(summary)) {
  if (absPath === 'total') continue;
  const rel = absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath;

  // Longest-prefix match: iterate from most specific to least specific.
  // DIRECTORY_THRESHOLDS is already ordered with nested paths before parents
  // for tui/hooks and tui/components, but we sort by length to be safe.
  const match = [...dirStats]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find(d => rel.startsWith(d.prefix));
  if (!match) continue;

  match.total += fileSummary.lines.total;
  match.covered += fileSummary.lines.covered;
}

const dirResults = dirStats.map(d => {
  const pct = d.total > 0 ? (d.covered / d.total) * 100 : 100;
  const pass = pct >= d.threshold;
  return { ...d, pct, pass };
});

const allDirsPass = dirResults.every(d => d.pass);

// ---------------------------------------------------------------------------
// 3. Read per-line coverage from json report
// ---------------------------------------------------------------------------

const detail = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'));

const coveredLinesByFile = {};

for (const [absPath, fileCov] of Object.entries(detail)) {
  const rel = absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath;
  const covered = new Set();

  for (const [id, count] of Object.entries(fileCov.s)) {
    if (count > 0) {
      const loc = fileCov.statementMap[id];
      for (let line = loc.start.line; line <= loc.end.line; line++) {
        covered.add(line);
      }
    }
  }

  coveredLinesByFile[rel] = covered;
}

// ---------------------------------------------------------------------------
// 4. Compute PR-changed-line coverage
// ---------------------------------------------------------------------------

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;

let prLinesCovered = 0;
let prLinesTotal = 0;
let prLinePct = 100;
const fileDetails = [];

if (baseSha && headSha) {
  const diffOutput = execSync(
    `git diff ${baseSha}...${headSha} --unified=0 --diff-filter=AM -- 'src/**/*.ts' 'src/**/*.tsx'`,
    { encoding: 'utf8' }
  );

  const changedLines = parseDiffForAddedLines(diffOutput);

  for (const [file, lines] of Object.entries(changedLines)) {
    // Skip test files and excluded paths
    if (
      file.includes('/__tests__/') ||
      file.endsWith('.test.ts') ||
      file.endsWith('.test.tsx') ||
      file.startsWith('src/assets/') ||
      file.startsWith('src/test-utils/') ||
      file.endsWith('.d.ts')
    ) {
      continue;
    }

    const coveredSet = coveredLinesByFile[file];

    let fileCovered = 0;
    if (coveredSet) {
      for (const line of lines) {
        if (coveredSet.has(line)) fileCovered++;
      }
    }
    // If coveredSet is undefined, the file was never loaded during tests —
    // count all changed lines as uncovered rather than skipping silently.

    prLinesTotal += lines.length;
    prLinesCovered += fileCovered;
    const pct = lines.length > 0 ? ((fileCovered / lines.length) * 100).toFixed(1) : '100.0';
    fileDetails.push({ file, changed: lines.length, covered: fileCovered, pct });
  }

  prLinePct = prLinesTotal > 0 ? (prLinesCovered / prLinesTotal) * 100 : 100;
}

const prPass = prLinePct >= PR_LINES_THRESHOLD;

// ---------------------------------------------------------------------------
// 5. Build report
// ---------------------------------------------------------------------------

const allPass = allDirsPass && prPass;

let report = `## Test Coverage Report\n\n`;
report += `### Overall\n\n`;
report += `| Metric | Coverage |\n`;
report += `|--------|----------|\n`;
report += `| Statements | ${stmtPct}% |\n`;
report += `| Branches | ${branchPct}% |\n`;
report += `| Functions | ${funcPct}% |\n`;
report += `| Lines | ${linePct}% |\n`;

report += `\n### Per-Directory Line Coverage\n\n`;
report += `| Directory | Coverage | Ratchet | Target | Status |\n`;
report += `|-----------|----------|---------|--------|--------|\n`;
for (const d of dirResults) {
  const totalDisplay = d.total > 0 ? `${d.pct.toFixed(1)}% (${d.covered}/${d.total})` : 'n/a';
  report += `| \`${d.prefix}\` | ${totalDisplay} | ${d.threshold}% | ${d.target}% | ${d.pass ? 'PASS' : 'FAIL'} |\n`;
}

report += `\n### PR Changed Lines\n\n`;
report += `**${prLinePct.toFixed(1)}%** (${prLinesCovered}/${prLinesTotal}) — threshold ${PR_LINES_THRESHOLD}% — ${prPass ? 'PASS' : 'FAIL'}\n`;

if (fileDetails.length > 0) {
  report += `\n<details><summary>Changed file coverage</summary>\n\n`;
  report += `| File | Changed Lines | Covered | Coverage |\n`;
  report += `|------|---------------|---------|----------|\n`;
  for (const f of fileDetails) {
    report += `| \`${f.file}\` | ${f.changed} | ${f.covered} | ${f.pct}% |\n`;
  }
  report += `\n</details>\n`;
}

console.log(report);

// ---------------------------------------------------------------------------
// 6. Post comment on PR
// ---------------------------------------------------------------------------

const prNumber = process.env.PR_NUMBER;
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

if (prNumber && token && repo) {
  const marker = '<!-- coverage-report -->';
  const body = `${marker}\n${report}`;
  const ghEnv = { ...process.env, GH_TOKEN: token };

  try {
    const commentsRaw = execSync(`gh api repos/${repo}/issues/${prNumber}/comments --paginate`, {
      encoding: 'utf8',
      env: ghEnv,
    });
    const comments = JSON.parse(commentsRaw);
    const existing = comments.find(c => c.body && c.body.startsWith(marker));

    if (existing) {
      execSync(`gh api repos/${repo}/issues/comments/${existing.id} -X PATCH --input -`, {
        input: JSON.stringify({ body }),
        encoding: 'utf8',
        env: ghEnv,
      });
    } else {
      execSync(`gh api repos/${repo}/issues/${prNumber}/comments --input -`, {
        input: JSON.stringify({ body }),
        encoding: 'utf8',
        env: ghEnv,
      });
    }
    console.log('Coverage comment posted to PR.');
  } catch (e) {
    console.warn('Failed to post PR comment:', e.message);
  }
}

// ---------------------------------------------------------------------------
// 7. Exit
// ---------------------------------------------------------------------------

if (!allPass) {
  const failures = [];
  for (const d of dirResults) {
    if (!d.pass) failures.push(`${d.prefix} ${d.pct.toFixed(1)}% < ${d.threshold}%`);
  }
  if (!prPass) failures.push(`PR changed-line coverage ${prLinePct.toFixed(1)}% < ${PR_LINES_THRESHOLD}%`);
  console.error(`\nCoverage check FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}

console.log('\nCoverage check PASSED.');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDiffForAddedLines(diffOutput) {
  const result = {};
  let currentFile = null;

  for (const line of diffOutput.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!result[currentFile]) result[currentFile] = [];
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      const start = parseInt(hunkMatch[1], 10);
      const count = parseInt(hunkMatch[2] ?? '1', 10);
      for (let i = start; i < start + count; i++) {
        result[currentFile].push(i);
      }
    }
  }

  return result;
}
