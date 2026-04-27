import { CHART_COLORS, PALETTE } from '../palette.js';
import type { DistributionSection, SectionData, TimelineSection } from '../types.js';

function buildTimelineConfig(s: SectionData) {
  const cfg = s.config as TimelineSection;
  const timeline = s.timeline ?? [];
  const labels = timeline.map(b => b.week);
  const datasets = cfg.series.map((k, j) => {
    const cum = k.startsWith('cumulative');
    return {
      label: k.replace(/([A-Z])/g, ' $1').trim(),
      data: timeline.map(b => (b[k] as number) || 0),
      type: cum ? 'line' : 'bar',
      backgroundColor: cum ? 'transparent' : j === 0 ? 'rgba(210,153,34,0.7)' : 'rgba(63,185,80,0.7)',
      borderColor: cum ? PALETTE.accent : undefined,
      borderWidth: cum ? 2 : 0,
      pointRadius: cum ? 2 : undefined,
      yAxisID: cum ? 'y1' : 'y',
      order: cum ? 0 : 1,
      borderRadius: cum ? 0 : 3,
    };
  });
  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index' },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Weekly' } },
        y1: {
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Cumulative' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  };
}

function buildDistributionConfig(s: SectionData) {
  const cfg = s.config as DistributionSection;
  const chart = s.chart;
  if (!chart) return null;
  if (cfg.chart === 'doughnut') {
    return {
      type: 'doughnut',
      data: {
        labels: chart.labels,
        datasets: [{ data: chart.values, backgroundColor: CHART_COLORS.slice(0, chart.labels.length) }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 8, font: { size: 11 } } } },
      },
    };
  }
  return {
    type: 'bar',
    data: {
      labels: chart.labels,
      datasets: [
        {
          data: chart.values,
          backgroundColor: chart.colors ?? CHART_COLORS.slice(0, chart.labels.length),
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: cfg.orientation === 'horizontal' ? 'y' : 'x',
      responsive: true,
      plugins: { legend: { display: false } },
    },
  };
}

function buildHistogramConfig(s: SectionData) {
  if (s.histogramGrouped) {
    const g = s.histogramGrouped;
    const keys = Object.keys(g);
    const first = g[keys[0] ?? ''];
    const labels = (first ?? []).map(b => b.label);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: keys.map((k, j) => ({
          label: k,
          data: (g[k] ?? []).map(b => b.count),
          backgroundColor: CHART_COLORS[j % CHART_COLORS.length],
          borderRadius: 2,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }
  if (s.histogram) {
    const n = s.histogram.length;
    const bg = s.histogram.map((_, j) => {
      const t = n > 1 ? j / (n - 1) : 0;
      return t < 0.25
        ? 'rgba(63,185,80,0.7)'
        : t < 0.5
          ? 'rgba(88,166,255,0.7)'
          : t < 0.75
            ? 'rgba(210,153,34,0.7)'
            : 'rgba(248,81,73,0.7)';
    });
    return {
      type: 'bar',
      data: {
        labels: s.histogram.map(b => b.label),
        datasets: [{ data: s.histogram.map(b => b.count), backgroundColor: bg, borderRadius: 3 }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }
  return null;
}

function buildChartConfig(s: SectionData) {
  const type = s.config.type;
  if (type === 'timeline') return buildTimelineConfig(s);
  if (type === 'distribution') return buildDistributionConfig(s);
  if (type === 'histogram') return buildHistogramConfig(s);
  return null;
}

export default function ChartSection({ sectionData, index }: { sectionData: SectionData; index: number }) {
  const chartConfig = buildChartConfig(sectionData);
  if (!chartConfig) return <div id={`s${index}`} />;
  return (
    <div id={`s${index}`}>
      <canvas data-chart={JSON.stringify(chartConfig)} />
    </div>
  );
}
