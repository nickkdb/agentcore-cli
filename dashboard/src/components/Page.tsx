import { PALETTE } from '../palette.js';
import type { DashboardConfig, PageData, SectionData } from '../types.js';
import Section from './Section.js';

const CSS = `
:root{--bg:${PALETTE.bg};--card:${PALETTE.card};--text:${PALETTE.text};--border:${PALETTE.border};--dim:${PALETTE.dim};--accent:${PALETTE.accent};--green:${PALETTE.green};--red:${PALETTE.red};--yellow:${PALETTE.yellow};--purple:${PALETTE.purple}}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;padding:24px;max-width:1400px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px}
.sub{color:var(--dim);font-size:13px;margin-bottom:16px}
nav{display:flex;gap:8px;margin-bottom:20px;padding:8px 12px;background:var(--card);border-radius:8px;border:1px solid var(--border)}
nav a{color:var(--dim);text-decoration:none;padding:6px 14px;border-radius:6px;font-weight:600;font-size:13px}
nav a:hover{color:var(--text);background:rgba(255,255,255,.04)}
nav a.active{color:var(--accent);background:rgba(31,111,235,.12)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.card h2{font-size:14px;color:var(--accent);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);position:relative}
.wide{grid-column:1/-1}
.row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}
.st{text-align:center;flex:1;min-width:90px;padding:8px 4px}
.st .v{font-size:26px;font-weight:700;line-height:1.2}
.st .l{font-size:11px;color:var(--dim);margin-top:2px}
.sm .v{font-size:18px}
.green{color:var(--green)}.red{color:var(--red)}.yellow{color:var(--yellow)}.accent{color:var(--accent)}.purple{color:var(--purple)}.dim{color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:600}
td{padding:6px 8px;border-bottom:1px solid #21262d}
tr:hover{background:rgba(255,255,255,.02)}
a{color:var(--accent);text-decoration:none}
.b{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.b-green{background:rgba(63,185,80,.15);color:var(--green)}
.b-red{background:rgba(248,81,73,.15);color:var(--red)}
.b-yellow{background:rgba(210,153,34,.15);color:var(--yellow)}
.b-blue{background:rgba(88,166,255,.15);color:var(--accent)}
.b-dim{background:rgba(139,148,158,.15);color:var(--dim)}
.b-purple{background:rgba(188,140,255,.15);color:var(--purple)}
footer{text-align:center;color:#484f58;font-size:12px;margin-top:24px;padding:16px}
canvas{max-height:300px}
.copy-btn{position:absolute;right:0;top:-2px;background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px;padding:4px 8px;border-radius:4px}
.copy-btn:hover{color:var(--text);background:rgba(255,255,255,.06)}
.copied{color:var(--green)!important}
.tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:8px}
.tab{background:none;border:none;color:var(--dim);font-size:12px;font-weight:600;padding:4px 12px;border-radius:4px;cursor:pointer}
.tab:hover{color:var(--text);background:rgba(255,255,255,.04)}
.tab.active{color:var(--accent);background:rgba(31,111,235,.12)}
.extra{margin-top:12px}
.extra h4{font-size:13px;color:var(--dim);margin-bottom:8px}
`;

const COPY_SCRIPT = `
document.querySelectorAll('.copy-btn').forEach(function(btn){
  btn.onclick=function(){
    var card=btn.closest('.card');
    var table=card.querySelector('table');
    var text='';
    if(table){
      var rows=[].slice.call(table.querySelectorAll('tr'));
      text=rows.map(function(r){return [].slice.call(r.querySelectorAll('th,td')).map(function(c){return c.textContent.trim()}).join(' | ')}).join('\\n');
    }else{text=card.textContent.replace(/📋/g,'').trim()}
    navigator.clipboard.writeText(text).then(function(){btn.textContent='✓';btn.classList.add('copied');setTimeout(function(){btn.textContent='📋';btn.classList.remove('copied')},1500)}).catch(function(){});
  };
});
`;

const GLOBAL_TAB_SCRIPT = `
(function(){
  var container = document.querySelector('[data-global-tabs]');
  if (!container) return;
  container.querySelectorAll('.tab').forEach(function(btn){
    btn.onclick = function(){
      container.querySelectorAll('.tab').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('[data-window-panel]').forEach(function(p){ p.style.display = 'none'; });
      var target = document.querySelector('[data-window-panel="' + btn.dataset.idx + '"]');
      if (target) { target.style.display = ''; if (window.initCharts) window.initCharts(target); }
    };
  });
})();
`;

function WindowedSections({ page, repo }: { page: PageData; repo: string }) {
  const windows = page.windowedSections ?? {};
  const tabs = ['All Time', ...Object.keys(windows)];
  const allSections: Record<string, SectionData[]> = { 'All Time': page.sections, ...windows };

  return (
    <>
      <div data-global-tabs="" class="tabs" style={{ marginBottom: '16px' }}>
        {tabs.map((t, j) => (
          <button class={`tab${j === 0 ? ' active' : ''}`} data-idx={j}>
            {t}
          </button>
        ))}
      </div>
      {tabs.map((t, j) => (
        <div data-window-panel={j} style={j > 0 ? { display: 'none' } : undefined}>
          <div class="grid">
            {allSections[t].map((s, i) => (
              <Section sectionData={s} index={j * 100 + i} repo={repo} />
            ))}
          </div>
        </div>
      ))}
      <script>{GLOBAL_TAB_SCRIPT}</script>
    </>
  );
}

export default function Page({
  page,
  config,
  currentRepo,
  currentPageId,
}: {
  page: PageData;
  config: DashboardConfig;
  currentRepo: string;
  currentPageId: string;
}) {
  const repoName = currentRepo.split('/')[1];

  /** e.g. ('aws/agentcore-cli', 'issues') → 'agentcore-cli-issues' */
  function pageFile(repo: string, pageId: string): string {
    return `${repo.split('/')[1]}-${pageId}`;
  }

  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{`${page.title} — ${currentRepo} Dashboard`}</title>
        <script src="chart.js" />
        <script src="charts.js" />
        <style>{CSS}</style>
      </head>
      <body>
        <h1>📊 Dashboard</h1>
        <p class="sub">
          Generated: {page.generatedAt}
        </p>
        {config.repos.length > 1 && (
          <nav>
            {config.repos.map(r => (
              <a
                href={`${pageFile(r, currentPageId)}.html`}
                class={r === currentRepo ? 'active' : undefined}
              >
                {r.split('/')[1]}
              </a>
            ))}
          </nav>
        )}
        <nav>
          {config.pages.map(p => (
            <a
              href={`${pageFile(currentRepo, p.id)}.html`}
              class={p.id === currentPageId ? 'active' : undefined}
            >
              {p.title}
            </a>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: '12px', padding: '6px 8px' }}>
            <a href={`https://github.com/${currentRepo}`}>{currentRepo}</a>
          </span>
        </nav>
        {page.windowedSections ? (
          <WindowedSections page={page} repo={currentRepo} />
        ) : (
          <div class="grid">
            {page.sections.map((s, i) => (
              <Section sectionData={s} index={i} repo={currentRepo} />
            ))}
          </div>
        )}
        <footer>Data fetched live from GitHub API</footer>
        <script>{COPY_SCRIPT}</script>
      </body>
    </>
  );
}
