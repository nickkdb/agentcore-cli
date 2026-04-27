import { CHART_COLORS } from '../palette.js';
import type { SectionData, TrendSection as TrendSectionConfig } from '../types.js';
import CISection from './CISection.js';
import ChartSection from './ChartSection.js';
import StatsSection from './StatsSection.js';
import TableSectionComponent from './TableSection.js';
import TermFrequencySection from './TermFrequencySection.js';

function sectionTitle(s: SectionData): string {
  const c = s.config;
  switch (c.type) {
    case 'stats':
      return '📊 Overview';
    case 'timeline':
      return '📈 Activity Over Time';
    case 'distribution': {
      const map: Record<string, string> = {
        labels: '🏷️ Issues by Label',
        age: '📅 Open Issue Age',
        sizeLabel: '📏 PR Size Distribution',
        bucket: '📊 Open PR Status',
        linkedIssuePriority: '🎯 PR Priority (from linked issues)',
      };
      return map[c.field] ?? `📊 ${c.field}`;
    }
    case 'histogram':
      return c.title ? `⏱️ ${c.title}` : `⏱️ ${c.field}`;
    case 'table':
      return `${c.id === 'stale' ? '🧊' : c.id === 'engagement' ? '💬' : '📋'} ${c.title}`;
    case 'termFrequency':
      return c.title ?? '🔍 Common Terms in Unlabeled Issues';
    case 'ci':
      return '🧪 CI / Test Health';
    case 'trend':
      return `📈 ${c.title}`;
    case 'weeklyTable':
      return `📅 ${c.title}`;
  }
}

const WIDE_TYPES = new Set(['stats', 'timeline', 'table', 'termFrequency', 'ci', 'weeklyTable']);

function TrendChart({
  trend,
  config,
}: {
  trend: { weeks: string[]; series: Record<string, number[]> };
  config: TrendSectionConfig;
}) {
  const chartConfig = {
    type: 'line' as const,
    data: {
      labels: trend.weeks,
      datasets: Object.entries(trend.series).map(([name, data], j) => ({
        label: name,
        data,
        borderColor: CHART_COLORS[j % CHART_COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.3,
      })),
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 10 } } },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: config.title.includes('days')
              ? config.aggregate === 'median'
                ? 'Median (days)'
                : 'Avg (days)'
              : config.aggregate === 'median'
                ? 'Median (hours)'
                : 'Avg (hours)',
          },
        },
      },
    },
  };
  return <canvas data-chart={JSON.stringify(chartConfig)} />;
}

function WeeklyTable({ data }: { data: { weeks: string[]; rows: Record<string, (string | number)[]> } }) {
  return (
    <div class="tbl">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            {data.weeks.map(w => (
              <th>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.rows).map(([metric, values]) => (
            <tr>
              <td>
                <strong>{metric}</strong>
              </td>
              {values.map(v => (
                <td>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionContent({ sectionData, index, repo }: { sectionData: SectionData; index: number; repo: string }) {
  const type = sectionData.config.type;
  if (type === 'stats' && sectionData.stats) {
    return <StatsSection stats={sectionData.stats} />;
  }
  if (type === 'timeline' || type === 'distribution' || type === 'histogram') {
    return <ChartSection sectionData={sectionData} index={index} />;
  }
  if (type === 'table' && sectionData.table && sectionData.config.type === 'table') {
    return <TableSectionComponent config={sectionData.config} table={sectionData.table} repo={repo} />;
  }
  if (type === 'ci' && sectionData.ci) {
    return <CISection ci={sectionData.ci} />;
  }
  if (type === 'termFrequency') {
    return <TermFrequencySection terms={sectionData.terms ?? []} unusedLabels={sectionData.unusedLabels ?? []} />;
  }
  if (type === 'trend' && sectionData.trend) {
    return <TrendChart trend={sectionData.trend} config={sectionData.config} />;
  }
  if (type === 'weeklyTable' && sectionData.weeklyTable) {
    return <WeeklyTable data={sectionData.weeklyTable} />;
  }
  return null;
}

export default function Section({
  sectionData,
  index,
  repo,
}: {
  sectionData: SectionData;
  index: number;
  repo: string;
}) {
  const wide = WIDE_TYPES.has(sectionData.config.type);
  const title = sectionTitle(sectionData);
  return (
    <div class={`card${wide ? ' wide' : ''}`}>
      <h2>
        {title}
        <button class="copy-btn">📋</button>
      </h2>
      <SectionContent sectionData={sectionData} index={index} repo={repo} />
    </div>
  );
}
