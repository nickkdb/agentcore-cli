import type { GHIssue, GHPullRequestNode, RunConclusion, WorkflowJob, WorkflowRun } from './types.js';
import { execFileSync } from 'node:child_process';

// 50MB buffer handles large paginated API responses (~10MB typical for 900 CI runs)
const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 50 * 1024 * 1024 };

function ghApi(...args: string[]): string {
  try {
    return execFileSync('gh', ['api', ...args], EXEC_OPTS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gh api call failed (args: ${args.join(' ')}): ${msg}`);
  }
}

function parseJSON<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON (${context}): ${msg}`);
  }
}

export function fetchIssues(repo: string): GHIssue[] {
  process.stderr.write(`Fetching issues for ${repo}...\n`);
  const raw = ghApi('--paginate', `/repos/${repo}/issues?state=all&per_page=100`);
  const items = parseJSON<GHIssue[]>(raw.trim(), 'fetchIssues');
  const issues = items.filter(i => !i.pull_request);
  process.stderr.write(`  Fetched ${issues.length} issues\n`);
  return issues;
}

export function fetchPRs(repo: string): GHPullRequestNode[] {
  const [owner, name] = repo.split('/');
  const prs: GHPullRequestNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number title state createdAt mergedAt closedAt isDraft
            author { login }
            labels(first: 10) { nodes { name } }
            reviews(first: 20) { nodes { author { login } state submittedAt } }
            commits(last: 1) { nodes { commit { committedDate } } }
            closingIssuesReferences(first: 3) { nodes { number labels(first: 5) { nodes { name } } } }
          }
        }
      }
    }`;

  for (;;) {
    page++;
    process.stderr.write(`Fetching PRs page ${page}...\n`);
    const args = ['graphql', '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${query}`];
    if (cursor) {
      args.push('-f', `cursor=${cursor}`);
    }
    const raw = ghApi(...args);
    const resp = parseJSON<{
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: GHPullRequestNode[];
          };
        };
      };
    }>(raw, `fetchPRs page ${page}`);
    const data = resp.data.repository.pullRequests;
    prs.push(...data.nodes);
    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  const filtered = prs.filter(pr => pr.author?.login !== 'github-actions[bot]');
  process.stderr.write(`  Fetched ${filtered.length} PRs (filtered from ${prs.length})\n`);
  return filtered;
}

interface GHWorkflow {
  id: number;
  name: string;
}
interface GHRunsResponse {
  workflow_runs: { id: number; conclusion: RunConclusion | null; created_at: string }[];
}
interface GHJobsResponse {
  jobs: { name: string; conclusion: RunConclusion | null; started_at: string; completed_at: string }[];
}

export function fetchCIRuns(repo: string, workflowNames: string[], branch: string, maxRuns: number): WorkflowRun[] {
  process.stderr.write(`Fetching CI runs for ${branch}...\n`);
  const wfList = parseJSON<GHWorkflow[]>(
    ghApi(`/repos/${repo}/actions/workflows`, '--jq', '.workflows'),
    'fetchCIRuns workflows'
  );
  const matched =
    workflowNames.length > 0 ? wfList.filter(w => workflowNames.includes(w.name)) : wfList.filter(w => w.name !== 'pages-build-deployment');
  if (matched.length === 0) {
    throw new Error(
      `No workflows found matching: ${workflowNames.join(', ')}\nAvailable: ${wfList.map(w => w.name).join(', ')}`
    );
  }
  const runs: WorkflowRun[] = [];
  // Distribute maxRuns evenly across workflows, staying under GitHub API rate limit (5000/hour)
  const perWf = Math.ceil(maxRuns / matched.length);

  for (const wf of matched) {
    process.stderr.write(`  ${wf.name}...\n`);
    let fetched = 0;
    let page = 1;
    while (fetched < perWf) {
      const resp = parseJSON<GHRunsResponse>(
        ghApi(`/repos/${repo}/actions/workflows/${wf.id}/runs?branch=${branch}&per_page=100&page=${page}`),
        `fetchCIRuns runs page ${page}`
      );
      if (resp.workflow_runs.length === 0) break;
      for (const run of resp.workflow_runs) {
        if (fetched >= perWf) break;
        let jobs: WorkflowJob[] = [];
        if (run.conclusion === 'failure') {
          const jobsResp = parseJSON<GHJobsResponse>(
            ghApi(`/repos/${repo}/actions/runs/${run.id}/jobs`),
            `fetchCIRuns jobs for run ${run.id}`
          );
          jobs = jobsResp.jobs.map(
            (j): WorkflowJob => ({
              name: j.name,
              conclusion: j.conclusion ?? 'in_progress',
              durationMin:
                j.completed_at && j.started_at
                  ? Math.round(((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 60000) * 10) /
                    10
                  : 0,
            })
          );
        }
        runs.push({
          id: run.id,
          workflowName: wf.name,
          conclusion: run.conclusion ?? 'in_progress',
          created: new Date(run.created_at),
          jobs,
        });
        fetched++;
      }
      process.stderr.write(`    ...${fetched} runs\n`);
      page++;
    }
  }
  process.stderr.write(`  ${runs.length} CI runs fetched\n`);
  return runs;
}
