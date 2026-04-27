import type { TableRow, TableSection as TableSectionConfig } from '../types.js';

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'b-red',
  P1: 'b-yellow',
  P2: 'b-blue',
  bug: 'b-red',
  enhancement: 'b-blue',
};

const BUCKET_COLORS: Record<string, string> = {
  'needs-re-review': 'b-red',
  'needs-initial-review': 'b-yellow',
  'waiting-on-author': 'b-dim',
  approved: 'b-green',
  closed: 'b-dim',
};

function CellValue({ col, value, repo, isPR }: { col: string; value: unknown; repo: string; isPR: boolean }) {
  const str = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (col === 'number') {
    const url = `https://github.com/${repo}/${isPR ? 'pull' : 'issues'}/${str}`;
    return <a href={url}>#{String(value)}</a>;
  }
  if (col === 'labels' && Array.isArray(value)) {
    if (value.length === 0) return <span class="b b-red">unlabeled</span>;
    return (
      <>
        {value.map((l: string) => (
          <span class="b b-blue" style={{ marginRight: '4px' }}>
            {l}
          </span>
        ))}
      </>
    );
  }
  if (col === 'state') {
    const cls = value === 'open' ? 'b-green' : 'b-dim';
    return <span class={`b ${cls}`}>{str}</span>;
  }
  if (col === 'draft') {
    return value ? <span class="b b-purple">draft</span> : null;
  }
  if (col === 'priority') {
    if (!value) return <span class="b b-dim">—</span>;
    const cls = PRIORITY_COLORS[str] ?? 'b-dim';
    return <span class={`b ${cls}`}>{str}</span>;
  }
  if (col === 'bucket') {
    const cls = BUCKET_COLORS[str] ?? 'b-dim';
    return <span class={`b ${cls}`}>{str}</span>;
  }
  if (col === 'age') return <>{String(value)}d</>;
  return <>{str}</>;
}

export default function TableSection({
  config,
  table,
  repo,
}: {
  config: TableSectionConfig;
  table: TableRow[];
  repo: string;
}) {
  const isPR = config.columns.includes('draft');
  return (
    <div class="tbl">
      <table>
        <thead>
          <tr>
            {config.columns.map(c => (
              <th>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map(row => (
            <tr>
              {config.columns.map(col => (
                <td>
                  <CellValue col={col} value={row[col]} repo={repo} isPR={isPR} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
