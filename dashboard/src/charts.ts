/* @strip */
declare const Chart: {
  new (canvas: HTMLCanvasElement, config: unknown): unknown;
  getChart(canvas: HTMLCanvasElement): { resize(): void } | undefined;
  defaults: { color: string; borderColor: string };
};
type InitCharts = (container: Element) => void;
interface Window {
  initCharts: InitCharts;
}
/* @strip */

function initCanvas(canvas: HTMLCanvasElement): void {
  if (Chart.getChart(canvas)) return;
  const raw = canvas.getAttribute('data-chart');
  if (!raw) return;
  try {
    new Chart(canvas, JSON.parse(raw) as unknown);
  } catch (e) {
    console.error('Failed to initialize chart:', e);
  }
}

function initCharts(container: Element): void {
  container.querySelectorAll<HTMLCanvasElement>('[data-chart]').forEach(c => {
    if (Chart.getChart(c)) {
      Chart.getChart(c)!.resize();
    } else {
      initCanvas(c);
    }
  });
}

(window as unknown as Window).initCharts = initCharts;

document.addEventListener('DOMContentLoaded', () => {
  Chart.defaults.color = '#8b949e';
  Chart.defaults.borderColor = '#30363d';

  document.querySelectorAll<HTMLCanvasElement>('[data-chart]').forEach(canvas => {
    if ((canvas as HTMLElement).offsetParent !== null) initCanvas(canvas);
  });
});
