import type { DashboardConfig, SectionConfig } from './types.js';

const ISSUE_SECTIONS: SectionConfig[] = [
  {
    type: 'stats',
    metrics: [
      'total',
      'open',
      'closed',
      'weeklyRate',
      'unlabeled',
      'unassigned',
      'medianResolution',
      'avgResolution',
      'p90Resolution',
      'completed',
      'notPlanned',
      'duplicates',
    ],
  },
  { type: 'timeline', bucket: 'week', series: ['opened', 'closed', 'cumulativeOpen'] },
  { type: 'distribution', field: 'labels', chart: 'doughnut' },
  { type: 'distribution', field: 'age', chart: 'bar', orientation: 'horizontal' },
  { type: 'trend', title: 'Avg Open Issue Age Over Time (days)', fields: ['openAgeDays'], aggregate: 'avg' },
  {
    type: 'histogram',
    field: 'resolutionHours',
    buckets: [0, 1, 4, 8, 12, 24, 48, 72, 168, 336, 720],
    groupBy: 'labels',
  },
  {
    type: 'table',
    id: 'engagement',
    title: 'Most Discussed Open Issues',
    filter: { state: 'open' },
    columns: ['number', 'title', 'comments', 'reactions', 'state'],
    limit: 10,
  },
  {
    type: 'table',
    id: 'stale',
    title: 'Stale Open Issues (>14 days, 0 comments)',
    filter: { state: 'open', minAgeDays: 14, maxComments: 0 },
    columns: ['number', 'title', 'age', 'labels'],
    limit: 20,
  },
  { type: 'termFrequency', filter: { labeled: false }, minCount: 3 },
  {
    type: 'weeklyTable',
    title: 'Weekly Summary (recent 8 weeks)',
    metrics: ['opened', 'closed', 'net', 'medianResolution'],
    weeks: 8,
  },
];

const PR_SECTIONS: SectionConfig[] = [
  {
    type: 'stats',
    metrics: [
      'total',
      'merged',
      'closedNoMerge',
      'open',
      'drafts',
      'mergeRate',
      'medianTTFR',
      'avgTTFR',
      'p90TTFR',
      'medianTTM',
      'avgTTM',
      'p90TTM',
    ],
  },
  { type: 'timeline', bucket: 'week', series: ['opened', 'merged', 'cumulativeOpen'] },
  { type: 'distribution', field: 'bucket', chart: 'doughnut' },
  { type: 'trend', title: 'Avg Open PR Age Over Time (days)', fields: ['openAgeDays'], aggregate: 'avg' },
  {
    type: 'histogram',
    field: 'ttfrHours',
    title: 'Time to First Review',
    buckets: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 72, 168],
  },
  {
    type: 'histogram',
    field: 'ttmHours',
    title: 'Time to Merge',
    buckets: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 72, 168],
  },
  { type: 'distribution', field: 'sizeLabel', chart: 'doughnut' },
  {
    type: 'histogram',
    field: 'ttmHours',
    title: 'Time to Merge by Size',
    buckets: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 72, 168],
    groupBy: 'sizeLabel',
  },
  {
    type: 'table',
    id: 'stale',
    title: 'Stale Open PRs (>7 days)',
    filter: { state: 'open', minAgeDays: 7 },
    columns: ['number', 'title', 'age', 'author', 'priority', 'lastActivity', 'draft'],
    limit: 15,
  },
  {
    type: 'weeklyTable',
    title: 'Weekly Summary (recent 8 weeks)',
    metrics: ['opened', 'merged', 'net', 'medianTTFR', 'medianTTM'],
    weeks: 8,
  },
];

const WINDOWS = [
  { label: 'Past 24h', days: 1 },
  { label: 'Past 7 days', days: 7 },
  { label: 'Past 30 days', days: 30 },
];

export const config: DashboardConfig = {
  repos: [
    'aws/agentcore-cli',
    'aws/bedrock-agentcore-sdk-python',
    'aws/bedrock-agentcore-sdk-typescript',
    'aws/bedrock-agentcore-starter-toolkit',
  ],
  outputDir: 'site/dashboard',
  pages: [
    { id: 'issues', title: 'Issues', dataSource: 'issues', windows: WINDOWS, sections: ISSUE_SECTIONS },
    { id: 'prs', title: 'Pull Requests', dataSource: 'prs', windows: WINDOWS, sections: PR_SECTIONS },
    {
      id: 'ci',
      title: 'CI / Tests',
      dataSource: 'ci',
      sections: [
        {
          type: 'ci',
          workflows: [],
          branch: 'main',
          maxRuns: 900,
        },
      ],
    },
  ],
};
