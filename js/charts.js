'use strict';

/* ─────────────────────────────────────────────────────────────────
   Charts  –  Chart.js v4  real-time throughput vs drops
───────────────────────────────────────────────────────────────── */

const CHART_OPTS = {
  responsive:           true,
  maintainAspectRatio:  false,
  animation:            false,
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: {
      display: true,
      grid:  { color: '#21262d', drawBorder: false },
      ticks: { color: '#8b949e', maxTicksLimit: 6, font: { size: 10, family: 'Courier New' } },
    },
    y: {
      display:    true,
      beginAtZero: true,
      grid:  { color: '#21262d', drawBorder: false },
      ticks: { color: '#8b949e', font: { size: 10, family: 'Courier New' },
               callback: v => v >= 1000 ? (v/1000).toFixed(0)+'G' : v.toFixed(0)+'M' },
    },
  },
  plugins: {
    legend: {
      labels: { color: '#8b949e', font: { size: 10, family: 'Segoe UI' }, boxWidth: 12, padding: 8 },
    },
    tooltip: {
      backgroundColor: '#161b22',
      borderColor:     '#30363d',
      borderWidth:     1,
      titleColor:      '#e6edf3',
      bodyColor:       '#8b949e',
      callbacks: {
        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} Mbps`,
      },
    },
  },
};

function makeDataset(label, color, dashed) {
  return {
    label,
    data:            [],
    borderColor:     color,
    backgroundColor: color + '22',
    borderWidth:     dashed ? 1.5 : 2,
    borderDash:      dashed ? [5, 3] : [],
    pointRadius:     0,
    tension:         0.25,
    fill:            false,
  };
}

class Charts {
  constructor() {
    Chart.defaults.color            = '#8b949e';
    Chart.defaults.backgroundColor  = '#161b22';

    this._downlink = new Chart(document.getElementById('chart-downlink'), {
      type: 'line',
      data: {
        labels:   [],
        datasets: [
          makeDataset('Throughput', '#388bfd', false),
          makeDataset('Drop Rate',  '#f85149', true),
          makeDataset('Max BW',     '#2a3a4a', true),
        ],
      },
      options: JSON.parse(JSON.stringify(CHART_OPTS)),
    });

    this._uplink = new Chart(document.getElementById('chart-uplink'), {
      type: 'line',
      data: {
        labels:   [],
        datasets: [
          makeDataset('Throughput', '#f0883e', false),
          makeDataset('Drop Rate',  '#f85149', true),
          makeDataset('Max BW',     '#3a2a1a', true),
        ],
      },
      options: JSON.parse(JSON.stringify(CHART_OPTS)),
    });
  }

  // Called each animation frame, but only redraws when history changes
  update(history, dlBw, ulBw) {
    if (!history.length) return;

    const MAX_PTS = 60;
    const slice   = history.slice(-MAX_PTS);

    const labels  = slice.map(h => h.time.toFixed(1) + 's');
    const dlThru  = slice.map(h => h.dlThru);
    const dlDrop  = slice.map(h => h.dlDropRate);
    const ulThru  = slice.map(h => h.ulThru);
    const ulDrop  = slice.map(h => h.ulDropRate);
    const dlMax   = slice.map(() => dlBw);
    const ulMax   = slice.map(() => ulBw);

    this._apply(this._downlink, labels, dlThru, dlDrop, dlMax);
    this._apply(this._uplink,   labels, ulThru, ulDrop, ulMax);
  }

  _apply(chart, labels, thru, drop, max) {
    chart.data.labels            = labels;
    chart.data.datasets[0].data  = thru;
    chart.data.datasets[1].data  = drop;
    chart.data.datasets[2].data  = max;
    chart.update('none'); // skip animation
  }

  reset() {
    for (const chart of [this._downlink, this._uplink]) {
      chart.data.labels = [];
      chart.data.datasets.forEach(ds => ds.data = []);
      chart.update('none');
    }
  }
}
