import {
  bucketLabel,
  buildHistogram,
  computeStats,
  formatHours,
  parseIssues,
  parsePRs,
  percentiles,
} from '../transform.js';
import type { GHIssue, GHPullRequestNode } from '../types.js';
import { describe, expect, it } from 'vitest';

// ── helpers ─────────────────────────────────────────────────────────

function makeGHIssue(overrides: Partial<GHIssue> = {}): GHIssue {
  return {
    number: 1,
    title: 'test issue',
    state: 'open',
    created_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    labels: [],
    assignees: [],
    comments: 0,
    reactions: { total_count: 0 },
    state_reason: null,
    closed_by: null,
    user: { login: 'alice' },
    author_association: 'MEMBER',
    ...overrides,
  };
}

function makeGHPR(overrides: Partial<GHPullRequestNode> = {}): GHPullRequestNode {
  return {
    number: 10,
    title: 'test pr',
    state: 'OPEN',
    createdAt: '2026-01-01T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    isDraft: false,
    author: { login: 'bob' },
    labels: { nodes: [] },
    reviews: { nodes: [] },
    commits: { nodes: [] },
    closingIssuesReferences: { nodes: [] },
    ...overrides,
  };
}

// ── percentiles ─────────────────────────────────────────────────────

describe('percentiles', () => {
  it('returns zeros for empty array', () => {
    expect(percentiles([])).toEqual({ median: 0, avg: 0, p90: 0 });
  });

  it('returns the value for a single-element array', () => {
    expect(percentiles([5])).toEqual({ median: 5, avg: 5, p90: 5 });
  });

  it('computes correct values for known input', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = percentiles(vals);
    expect(result.median).toBe(6);
    expect(result.avg).toBeCloseTo(5.5);
    expect(result.p90).toBe(10);
  });
});

// ── formatHours ─────────────────────────────────────────────────────

describe('formatHours', () => {
  it('returns minutes when < 1 hour', () => {
    expect(formatHours(0.5)).toBe('30m');
  });

  it('returns hours when >= 1 and < 24', () => {
    expect(formatHours(2.5)).toBe('2.5h');
  });

  it('returns days when >= 24', () => {
    expect(formatHours(48)).toBe('2.0d');
  });

  it('handles zero', () => {
    expect(formatHours(0)).toBe('0m');
  });

  it('handles boundary at exactly 1 hour', () => {
    expect(formatHours(1)).toBe('1.0h');
  });

  it('handles boundary at exactly 24 hours', () => {
    expect(formatHours(24)).toBe('1.0d');
  });
});

// ── bucketLabel ─────────────────────────────────────────────────────

describe('bucketLabel', () => {
  it('formats a range in minutes', () => {
    expect(bucketLabel(0.25, 0.5)).toBe('15m-30m');
  });

  it('formats a range in hours', () => {
    expect(bucketLabel(1, 2)).toBe('1.0h-2.0h');
  });

  it('formats a range in days', () => {
    expect(bucketLabel(24, 48)).toBe('1.0d-2.0d');
  });

  it('formats open-ended bucket when high is undefined', () => {
    expect(bucketLabel(168, undefined)).toBe('>7.0d');
  });
});

// ── parseIssues ─────────────────────────────────────────────────────

describe('parseIssues', () => {
  it('parses a minimal open issue', () => {
    const result = parseIssues([makeGHIssue()]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 1,
      title: 'test issue',
      state: 'open',
      labels: [],
      closed: null,
      author: 'alice',
    });
    expect(result[0].created).toBeInstanceOf(Date);
  });

  it('parses labels and assignees', () => {
    const result = parseIssues([
      makeGHIssue({
        labels: [{ name: 'bug' }, { name: 'P1' }],
        assignees: [{ login: 'carol' }],
      }),
    ]);
    expect(result[0].labels).toEqual(['bug', 'P1']);
    expect(result[0].assignees).toEqual(['carol']);
  });

  it('parses closed date', () => {
    const result = parseIssues([
      makeGHIssue({
        state: 'closed',
        closed_at: '2026-01-02T00:00:00Z',
      }),
    ]);
    expect(result[0].state).toBe('closed');
    expect(result[0].closed).toBeInstanceOf(Date);
  });

  it('filters out pull request items', () => {
    const result = parseIssues([makeGHIssue(), makeGHIssue({ number: 2, pull_request: {} })]);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseIssues([])).toEqual([]);
  });
});

// ── parsePRs ────────────────────────────────────────────────────────

describe('parsePRs', () => {
  it('calculates ttfrHours from first review', () => {
    const pr = makeGHPR({
      createdAt: '2026-01-01T00:00:00Z',
      reviews: {
        nodes: [{ author: { login: 'rev' }, state: 'COMMENTED', submittedAt: '2026-01-01T02:00:00Z' }],
      },
    });
    const result = parsePRs([pr]);
    expect(result[0].ttfrHours).toBeCloseTo(2);
  });

  it('calculates ttmHours from merged date', () => {
    const pr = makeGHPR({
      createdAt: '2026-01-01T00:00:00Z',
      mergedAt: '2026-01-02T12:00:00Z',
      state: 'MERGED',
    });
    const result = parsePRs([pr]);
    expect(result[0].ttmHours).toBeCloseTo(36);
  });

  it('returns null ttfrHours when no reviews', () => {
    const result = parsePRs([makeGHPR()]);
    expect(result[0].ttfrHours).toBeNull();
  });

  it('assigns needs-initial-review when no reviews', () => {
    const result = parsePRs([makeGHPR()]);
    expect(result[0].bucket).toBe('needs-initial-review');
  });

  it('assigns needs-re-review when commit after review', () => {
    const pr = makeGHPR({
      reviews: {
        nodes: [{ author: { login: 'rev' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-02T00:00:00Z' }],
      },
      commits: {
        nodes: [{ commit: { committedDate: '2026-01-03T00:00:00Z' } }],
      },
    });
    const result = parsePRs([pr]);
    expect(result[0].bucket).toBe('needs-re-review');
  });

  it('assigns approved when all reviews approved', () => {
    const pr = makeGHPR({
      reviews: {
        nodes: [
          { author: { login: 'rev1' }, state: 'APPROVED', submittedAt: '2026-01-02T00:00:00Z' },
          { author: { login: 'rev2' }, state: 'APPROVED', submittedAt: '2026-01-02T01:00:00Z' },
        ],
      },
    });
    const result = parsePRs([pr]);
    expect(result[0].bucket).toBe('approved');
  });

  it('assigns waiting-on-author when review is not all approved', () => {
    const pr = makeGHPR({
      reviews: {
        nodes: [{ author: { login: 'rev' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-02T00:00:00Z' }],
      },
    });
    const result = parsePRs([pr]);
    expect(result[0].bucket).toBe('waiting-on-author');
  });

  it('assigns closed bucket for merged PRs', () => {
    const pr = makeGHPR({ state: 'MERGED', mergedAt: '2026-01-02T00:00:00Z' });
    const result = parsePRs([pr]);
    expect(result[0].bucket).toBe('closed');
  });

  it('extracts linkedIssuePriority with P0 > P1 > bug > enhancement', () => {
    const pr = makeGHPR({
      closingIssuesReferences: {
        nodes: [
          { number: 1, labels: { nodes: [{ name: 'enhancement' }, { name: 'P1' }] } },
          { number: 2, labels: { nodes: [{ name: 'bug' }] } },
        ],
      },
    });
    const result = parsePRs([pr]);
    expect(result[0].linkedIssuePriority).toBe('P1');
  });

  it('returns null linkedIssuePriority when no closing issues', () => {
    const result = parsePRs([makeGHPR()]);
    expect(result[0].linkedIssuePriority).toBeNull();
  });

  it('uses ghost as author when author is null', () => {
    const pr = makeGHPR({ author: null });
    const result = parsePRs([pr]);
    expect(result[0].author).toBe('ghost');
  });
});

// ── computeStats ────────────────────────────────────────────────────

describe('computeStats', () => {
  const openIssue = parseIssues([makeGHIssue()])[0];
  const closedIssue = parseIssues([
    makeGHIssue({
      number: 2,
      state: 'closed',
      created_at: '2026-01-01T00:00:00Z',
      closed_at: '2026-01-02T00:00:00Z',
      state_reason: 'completed',
      closed_by: { login: 'closer' },
    }),
  ])[0];

  it('computes total, open, closed counts', () => {
    const stats = computeStats(['total', 'open', 'closed'], [openIssue, closedIssue]);
    expect(stats).toEqual([
      { key: 'Total', value: 2 },
      { key: 'Open', value: 1, color: 'green' },
      { key: 'Closed', value: 1 },
    ]);
  });

  it('returns N/A for unknown metric', () => {
    const stats = computeStats(['nonexistent'], [openIssue]);
    expect(stats[0]).toEqual({ key: 'nonexistent', value: 'N/A' });
  });

  it('handles empty items', () => {
    const stats = computeStats(['total', 'open'], []);
    expect(stats).toEqual([
      { key: 'Total', value: 0 },
      { key: 'Open', value: 0, color: 'green' },
    ]);
  });

  it('computes resolution percentiles via medianResolution', () => {
    const stats = computeStats(['medianResolution'], [closedIssue]);
    expect(stats[0].key).toBe('Median Resolution');
    expect(stats[0].value).toBe('1.0d');
  });
});

// ── buildHistogram ──────────────────────────────────────────────────

describe('buildHistogram', () => {
  it('buckets values into explicit boundaries', () => {
    const values = [0.1, 0.3, 1, 5, 25, 50];
    const buckets = [0, 0.25, 0.5, 1, 2, 24, 48];
    const result = buildHistogram(values, buckets);

    expect(result[0]).toMatchObject({ label: '<15m', count: 1 });
    expect(result[1]).toMatchObject({ count: 1 });
    expect(result[result.length - 1].label).toContain('>');
    expect(result[result.length - 1].count).toBe(1);
  });

  it('returns zero counts for empty values', () => {
    const result = buildHistogram([], [0, 1, 2]);
    expect(result.every(b => b.count === 0)).toBe(true);
  });

  it('handles single bucket', () => {
    const result = buildHistogram([5], [0]);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it('places boundary values in the lower bucket (>= low, < high)', () => {
    const result = buildHistogram([1], [0, 1, 2]);
    expect(result[0].count).toBe(0);
    expect(result[1].count).toBe(1);
    expect(result[2].count).toBe(0);
  });
});
