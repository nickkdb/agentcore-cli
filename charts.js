function initCanvas(canvas) {
  if (Chart.getChart(canvas)) return;
  const raw = canvas.getAttribute("data-chart");
  if (!raw) return;
  try {
    new Chart(canvas, JSON.parse(raw));
  } catch (e) {
    console.error("Failed to initialize chart:", e);
  }
}
function initCharts(container) {
  container.querySelectorAll("[data-chart]").forEach((c) => {
    if (Chart.getChart(c)) {
      Chart.getChart(c).resize();
    } else {
      initCanvas(c);
    }
  });
}
window.initCharts = initCharts;
document.addEventListener("DOMContentLoaded", () => {
  Chart.defaults.color = "#8b949e";
  Chart.defaults.borderColor = "#30363d";
  document.querySelectorAll("[data-chart]").forEach((canvas) => {
    if (canvas.offsetParent !== null) initCanvas(canvas);
  });
});
