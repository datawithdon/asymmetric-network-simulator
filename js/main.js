'use strict';

/* ─────────────────────────────────────────────────────────────────
   Main  –  wires simulation, renderer, charts and UI together
───────────────────────────────────────────────────────────────── */

// ── Slider log-scale helpers ───────────────────────────────────
// Sliders use 0-100 linear range mapping to a logarithmic value range.
function logScale(t, lo, hi) {
  return Math.round(Math.exp(Math.log(lo) + (t / 100) * (Math.log(hi) - Math.log(lo))));
}
function logInv(v, lo, hi) {
  return Math.round((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * 100);
}

// Bandwidth: 1 Mbps – 10 000 Mbps
const toBw  = t => logScale(t, 1, 10000);
const fromBw= v => logInv(v, 1, 10000);

// Buffer: 16 KB – 64 MB (in bytes)
const toBuf  = t => logScale(t, 16384, 67108864);
const fromBuf= v => logInv(v, 16384, 67108864);

function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024)    return (b / 1024).toFixed(0)    + ' KB';
  return b + ' B';
}
function fmtMbps(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + ' Gbps';
  if (m >= 1)    return m.toFixed(0) + ' Mbps';
  return (m * 1000).toFixed(0) + ' Kbps';
}

// ── Presets ────────────────────────────────────────────────────
const PRESETS = {
  adsl: {
    serverSendRate: 30, clientSendRate: 3,
    downlinkBandwidth: 20, uplinkBandwidth: 1,
    serverTxBuffer: 262144, clientTxBuffer: 65536, linkLatency: 35,
    label: 'ADSL Overload  (30 Mbps↓ into 20 Mbps pipe; 3 Mbps↑ into 1 Mbps)',
  },
  san: {
    serverSendRate: 2500, clientSendRate: 200,
    downlinkBandwidth: 1000, uplinkBandwidth: 200,
    serverTxBuffer: 2097152, clientTxBuffer: 524288, linkLatency: 2,
    label: 'SAN Bottleneck  (2.5 Gbps write into 1 Gbps storage link)',
  },
  symmetric: {
    serverSendRate: 600, clientSendRate: 600,
    downlinkBandwidth: 1000, uplinkBandwidth: 1000,
    serverTxBuffer: 1048576, clientTxBuffer: 1048576, linkLatency: 5,
    label: 'Symmetric LAN  (600 Mbps each ↔ 1 Gbps link, no congestion)',
  },
  idle: {
    serverSendRate: 2, clientSendRate: 1,
    downlinkBandwidth: 100, uplinkBandwidth: 10,
    serverTxBuffer: 524288, clientTxBuffer: 65536, linkLatency: 20,
    label: 'Idle  (low traffic, no congestion)',
  },
};

// ── App state ──────────────────────────────────────────────────
let running = false;
let simSpeed = 1;

const sim      = new Simulation();
const renderer = new Renderer('canvas-container', sim);
const charts   = new Charts();

// ── Slider definitions ─────────────────────────────────────────
const SLIDERS = [
  { id: 'sl-srv-send', svId: 'sv-srv-send', cfg: 'serverSendRate',    toVal: toBw,   fmt: fmtMbps },
  { id: 'sl-cli-send', svId: 'sv-cli-send', cfg: 'clientSendRate',    toVal: toBw,   fmt: fmtMbps },
  { id: 'sl-dl-bw',    svId: 'sv-dl-bw',    cfg: 'downlinkBandwidth', toVal: toBw,   fmt: fmtMbps },
  { id: 'sl-ul-bw',    svId: 'sv-ul-bw',    cfg: 'uplinkBandwidth',   toVal: toBw,   fmt: fmtMbps },
  { id: 'sl-srv-buf',  svId: 'sv-srv-buf',  cfg: 'serverTxBuffer',    toVal: toBuf,  fmt: fmtBytes },
  { id: 'sl-cli-buf',  svId: 'sv-cli-buf',  cfg: 'clientTxBuffer',    toVal: toBuf,  fmt: fmtBytes },
];

function readSlider(def) {
  const el  = document.getElementById(def.id);
  const val = def.toVal(+el.value);
  document.getElementById(def.svId).textContent = def.fmt(val);
  return val;
}

function syncSlidersToConfig(cfg) {
  SLIDERS.forEach(def => {
    const el = document.getElementById(def.id);
    if      (def.cfg === 'serverTxBuffer' || def.cfg === 'clientTxBuffer')
      el.value = fromBuf(cfg[def.cfg]);
    else
      el.value = fromBw(cfg[def.cfg]);
    document.getElementById(def.svId).textContent = def.fmt(cfg[def.cfg]);
  });
  // Latency slider (linear, no log)
  const latEl = document.getElementById('sl-latency');
  latEl.value = cfg.linkLatency;
  document.getElementById('sv-latency').textContent = cfg.linkLatency + ' ms';
}

function applySliders() {
  const patch = {};
  SLIDERS.forEach(def => { patch[def.cfg] = readSlider(def); });
  patch.linkLatency = +document.getElementById('sl-latency').value;
  document.getElementById('sv-latency').textContent = patch.linkLatency + ' ms';
  sim.setConfig(patch);
  renderer.updateBwLabels(patch.downlinkBandwidth, patch.uplinkBandwidth);
}

// ── Wire up controls ───────────────────────────────────────────
function wireControls() {
  // All sliders → live update
  document.querySelectorAll('.slider-row input[type="range"]').forEach(el => {
    el.addEventListener('input', applySliders);
  });

  // Play / Pause / Step / Reset
  document.getElementById('btn-play').addEventListener('click', () => {
    running = true;
    document.getElementById('btn-play').classList.add('active');
    document.getElementById('btn-pause').classList.remove('active');
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    running = false;
    document.getElementById('btn-pause').classList.add('active');
    document.getElementById('btn-play').classList.remove('active');
  });

  document.getElementById('btn-step').addEventListener('click', () => {
    if (running) return; // step only when paused
    sim.tick(1 / 60);
    renderer.update(1 / 60);
    charts.update(sim.history, sim.config.downlinkBandwidth, sim.config.uplinkBandwidth);
    updateStatus();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    sim.reset();
    charts.reset();
    updateStatus();
  });

  // Speed buttons
  document.querySelectorAll('.btn-speed').forEach(btn => {
    btn.addEventListener('click', () => {
      simSpeed = +btn.dataset.speed;
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Preset buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = PRESETS[btn.dataset.preset];
      if (!p) return;
      sim.setConfig(p);
      sim.reset();
      charts.reset();
      syncSlidersToConfig(sim.config);
      renderer.updateBwLabels(sim.config.downlinkBandwidth, sim.config.uplinkBandwidth);
    });
  });
}

// ── Status bar ────────────────────────────────────────────────
function updateStatus() {
  const s   = sim.state;
  const cfg = sim.config;

  document.getElementById('st-time').textContent =
    `Time: ${(sim.time / 1000).toFixed(1)}s`;

  const dlUtil = cfg.downlinkBandwidth > 0
    ? Math.round(s.dlThroughput / cfg.downlinkBandwidth * 100) : 0;
  document.getElementById('st-dl').textContent =
    `↓ DL: ${fmtMbps(s.dlThroughput)}  (${dlUtil}% util) | Drops: ${fmtBytes(s.dlDropTotal)}`;

  const ulUtil = cfg.uplinkBandwidth > 0
    ? Math.round(s.ulThroughput / cfg.uplinkBandwidth * 100) : 0;
  document.getElementById('st-ul').textContent =
    `↑ UL: ${fmtMbps(s.ulThroughput)}  (${ulUtil}% util) | Drops: ${fmtBytes(s.ulDropTotal)}`;

  const sTxPct = cfg.serverTxBuffer > 0
    ? Math.round(s.serverTxUsed / cfg.serverTxBuffer * 100) : 0;
  const cTxPct = cfg.clientTxBuffer > 0
    ? Math.round(s.clientTxUsed / cfg.clientTxBuffer * 100) : 0;
  document.getElementById('st-buf').textContent =
    `Buffers: S-TX ${sTxPct}%  |  C-TX ${cTxPct}%`;
}

// ── Main ticker (driven by Pixi.js) ───────────────────────────
let _lastHistLen = 0;

renderer._app.ticker.add(() => {
  const dt = Math.min(renderer._app.ticker.deltaMS / 1000, 0.05);

  if (running) {
    sim.tick(dt * simSpeed);
  }

  renderer.update(dt);

  // Update charts and status only when history grows (every 500 ms sim-time)
  if (sim.history.length !== _lastHistLen) {
    _lastHistLen = sim.history.length;
    charts.update(sim.history, sim.config.downlinkBandwidth, sim.config.uplinkBandwidth);
    updateStatus();
  }
});

// ── Boot ──────────────────────────────────────────────────────
(function boot() {
  wireControls();
  syncSlidersToConfig(sim.config);
  renderer.updateBwLabels(sim.config.downlinkBandwidth, sim.config.uplinkBandwidth);
  updateStatus();

  // Start paused so user can inspect default config first
  document.getElementById('btn-pause').classList.add('active');
})();
