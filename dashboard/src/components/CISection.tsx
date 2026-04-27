import { PALETTE } from '../palette.js';
import type { CIData } from '../types.js';

function rateColor(pct: number): string {
  return pct >= 90 ? PALETTE.green : pct >= 70 ? PALETTE.yellow : PALETTE.red;
}

function PassRateCards({ overall, passRate }: { overall: number; passRate: Record<string, number> }) {
  return (
    <div class="row">
      <div class="st">
        <div class="v" style={{ color: rateColor(overall) }}>
          {overall}%
        </div>
        <div class="l">Overall Pass Rate</div>
      </div>
      {Object.entries(passRate).map(([name, rate]) => (
        <div class="st">
          <div class="v" style={{ color: rateColor(rate) }}>
            {rate}%
          </div>
          <div class="l">{name}</div>
        </div>
      ))}
    </div>
  );
}

const CI_TAB_SCRIPT = `
(function(){
  document.querySelectorAll('[data-ci-tabs]').forEach(function(container){
    container.querySelectorAll('.tab').forEach(function(btn){
      btn.onclick=function(){
        container.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});
        btn.classList.add('active');
        container.querySelectorAll('.tab-panel').forEach(function(p){p.style.display='none'});
        container.querySelector('[data-panel="'+btn.dataset.idx+'"]').style.display='';
      };
    });
  });
})();
`;

function buildTimelineChart(ci: CIData) {
  return {
    type: 'bar',
    data: {
      labels: ci.timeline.map(w => w.week),
      datasets: [
        {
          label: 'Pass',
          data: ci.timeline.map(w => w.pass),
          backgroundColor: 'rgba(63,185,80,0.7)',
          borderRadius: 3,
        },
        {
          label: 'Fail',
          data: ci.timeline.map(w => w.fail),
          backgroundColor: 'rgba(248,81,73,0.7)',
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
    },
  };
}

function buildDurationChart(ci: CIData) {
  const jobs = Object.keys(ci.avgDuration);
  return {
    type: 'bar',
    data: {
      labels: jobs,
      datasets: [
        {
          data: jobs.map(j => ci.avgDuration[j]),
          backgroundColor: 'rgba(88,166,255,0.7)',
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false }, title: { display: true, text: 'Avg Duration (min)' } },
    },
  };
}

export default function CISection({ ci }: { ci: CIData }) {
  const windows = ci.windows ?? {};
  const tabs = ['All Time', ...Object.keys(windows)];
  const allData: Record<string, { overallPassRate: number; passRate: Record<string, number> }> = {
    'All Time': { overallPassRate: ci.overallPassRate, passRate: ci.passRate },
    ...windows,
  };

  return (
    <>
      <div data-ci-tabs="">
        <div class="tabs">
          {tabs.map((t, j) => (
            <button class={`tab${j === 0 ? ' active' : ''}`} data-idx={j}>
              {t}
            </button>
          ))}
        </div>
        {tabs.map((t, j) => {
          const d = allData[t];
          return (
            <div class="tab-panel" style={j > 0 ? { display: 'none' } : undefined} data-panel={j}>
              {d && <PassRateCards overall={d.overallPassRate} passRate={d.passRate} />}
            </div>
          );
        })}
        <script>{CI_TAB_SCRIPT}</script>
      </div>

      <div class="grid" style={{ marginTop: '16px' }}>
        <div class="card wide">
          <h2>📈 Pass/Fail Over Time</h2>
          <canvas data-chart={JSON.stringify(buildTimelineChart(ci))} />
        </div>
      </div>

      <div class="grid" style={{ marginTop: '16px' }}>
        <div class="card">
          <h2>❌ Most Failing Jobs</h2>
          {ci.failingJobs.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Failures</th>
                  <th>Total Runs</th>
                  <th>Fail Rate</th>
                </tr>
              </thead>
              <tbody>
                {ci.failingJobs.map(j => {
                  const cls = j.rate >= 20 ? 'b-red' : j.rate >= 10 ? 'b-yellow' : 'b-dim';
                  return (
                    <tr>
                      <td>{j.job}</td>
                      <td>{j.failures}</td>
                      <td>{j.total}</td>
                      <td>
                        <span class={`b ${cls}`}>{j.rate}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--dim)' }}>No failures!</p>
          )}
        </div>
        <div class="card">
          <h2>🔄 Flaky Jobs (pass↔fail flips)</h2>
          {ci.flaky.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Pass/Fail Flips</th>
                </tr>
              </thead>
              <tbody>
                {ci.flaky.map(f => (
                  <tr>
                    <td>{f.job}</td>
                    <td>
                      <span class="b b-yellow">{f.flipCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--dim)' }}>No flaky jobs detected (threshold: 3+ flips)</p>
          )}
        </div>
      </div>

      <div class="grid" style={{ marginTop: '16px' }}>
        <div class="card">
          <h2>🕐 Avg Job Duration</h2>
          <canvas data-chart={JSON.stringify(buildDurationChart(ci))} />
        </div>
        <div class="card">
          <h2>🔥 Recent Failures</h2>
          {ci.recentFailures.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Workflow</th>
                  <th>Failed Jobs</th>
                </tr>
              </thead>
              <tbody>
                {ci.recentFailures.map(r => (
                  <tr>
                    <td>{r.date}</td>
                    <td>{r.workflow}</td>
                    <td>
                      {r.failedJobs.map(j => (
                        <span class="b b-red" style={{ marginRight: '4px' }}>
                          {j}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </>
  );
}
