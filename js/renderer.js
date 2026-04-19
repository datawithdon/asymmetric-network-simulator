'use strict';

/* ─────────────────────────────────────────────────────────────────
   Renderer  –  Pixi.js v7 WebGL visualisation
───────────────────────────────────────────────────────────────── */

const C = {
  bg:          0x0d1117,
  panel:       0x161b22,
  // Nodes
  srvFill:     0x0d2137,
  srvBorder:   0x1f6feb,
  cliFill:     0x1a0a00,
  cliBorder:   0xf0883e,
  // Pipes
  dlPipeBg:    0x0a1929,
  ulPipeBg:    0x1a0d00,
  dlPipeBrd:   0x1a3a5c,
  ulPipeBrd:   0x3d1e00,
  // Particles
  dlParticle:  0x4fc3f7,
  ulParticle:  0xffb74d,
  dropParticle:0xff1744,
  // Buffer meter
  bufGreen:    0x1b5e20,
  bufAmber:    0xf9a825,
  bufRed:      0xb71c1c,
  bufCritical: 0xff1744,
  // Text
  textMain:    0xe6edf3,
  textDim:     0x8b949e,
};

// ── Layout constants (canvas = 1000 × 450) ─────────────────────
const L = {
  W: 1000, H: 450,
  srvX: 55,  srvY: 100, srvW: 115, srvH: 250,
  cliX: 830, cliY: 100, cliW: 115, cliH: 250,
  pipeX0: 175, pipeX1: 825,
  dlPipeY: 170, ulPipeY: 255, pipeH: 35,
  // Meter dimensions (attached at pipe openings)
  meterW: 14, meterH: 35,
};

L.pipeLen  = L.pipeX1 - L.pipeX0;
L.dlPipeYc = L.dlPipeY + L.pipeH / 2;
L.ulPipeYc = L.ulPipeY + L.pipeH / 2;


class Renderer {
  constructor(containerId, sim) {
    this.sim  = sim;
    this._app = null;
    this._dl  = null;   // downlink particle Graphics
    this._ul  = null;   // uplink particle Graphics
    this._drp = null;   // drop-burst particle Graphics

    this._dlParticles  = this._makePool(120);
    this._ulParticles  = this._makePool(120);
    this._dropParticles= this._makePool(80);

    this._dlSpawnAcc   = 0;
    this._ulSpawnAcc   = 0;
    this._lastDropEffect = { dl: -1, ul: -1 };

    // Dynamic graphics refs
    this._meterGfx = {};
    this._utilGfx  = null;
    this._statsText= null;
    this._nodeInfoText = {};

    this._init(containerId);
    this._buildScene();
  }

  // ── Init Pixi ──────────────────────────────────────────────
  _init(id) {
    this._app = new PIXI.Application({
      width:           L.W,
      height:          L.H,
      backgroundColor: C.bg,
      antialias:       true,
      resolution:      Math.min(window.devicePixelRatio || 1, 2),
      autoDensity:     true,
    });
    document.getElementById(id).appendChild(this._app.view);
    this._app.view.style.width  = '100%';
    this._app.view.style.height = '100%';
  }

  // ── Build static + dynamic scene ──────────────────────────
  _buildScene() {
    const stage = this._app.stage;

    // Background subtle grid
    stage.addChild(this._makeGrid());

    // Pipe backgrounds (static)
    const pipeBg = new PIXI.Graphics();
    pipeBg.beginFill(C.dlPipeBg);
    pipeBg.drawRoundedRect(L.pipeX0, L.dlPipeY, L.pipeLen, L.pipeH, 4);
    pipeBg.endFill();
    pipeBg.beginFill(C.ulPipeBg);
    pipeBg.drawRoundedRect(L.pipeX0, L.ulPipeY, L.pipeLen, L.pipeH, 4);
    pipeBg.endFill();
    stage.addChild(pipeBg);

    // Utilization overlay (dynamic fill)
    this._utilGfx = new PIXI.Graphics();
    stage.addChild(this._utilGfx);

    // Particle layers
    this._dl  = new PIXI.Graphics(); stage.addChild(this._dl);
    this._ul  = new PIXI.Graphics(); stage.addChild(this._ul);

    // Pipe borders (on top of util overlay)
    const pipeBrd = new PIXI.Graphics();
    pipeBrd.lineStyle(1, C.dlPipeBrd, 0.9);
    pipeBrd.drawRoundedRect(L.pipeX0, L.dlPipeY, L.pipeLen, L.pipeH, 4);
    pipeBrd.lineStyle(1, C.ulPipeBrd, 0.9);
    pipeBrd.drawRoundedRect(L.pipeX0, L.ulPipeY, L.pipeLen, L.pipeH, 4);
    stage.addChild(pipeBrd);

    // Pipe direction arrows + labels
    stage.addChild(this._makePipeLabels());

    // Node rectangles (static)
    const nodes = new PIXI.Graphics();
    this._drawNode(nodes, L.srvX, L.srvY, L.srvW, L.srvH, C.srvFill, C.srvBorder);
    this._drawNode(nodes, L.cliX, L.cliY, L.cliW, L.cliH, C.cliFill, C.cliBorder);
    stage.addChild(nodes);

    // Node labels (static)
    stage.addChild(this._makeNodeLabel(L.srvX + L.srvW/2, L.srvY + 22, 'SERVER', C.srvBorder));
    stage.addChild(this._makeNodeLabel(L.cliX + L.cliW/2, L.cliY + 22, 'CLIENT', C.cliBorder));

    // Node sub-labels (static capability)
    stage.addChild(this._makeSubLabel(L.srvX + L.srvW/2, L.srvY + 42, '10 Gbps NIC'));
    stage.addChild(this._makeSubLabel(L.cliX + L.cliW/2, L.cliY + 42, '100 Mbps NIC'));

    // Buffer meters (dynamic) ─ 4 meters
    // Server Tx  → right edge of server, downlink pipe level
    this._meterGfx.srvTx = this._addMeter(stage, L.srvX + L.srvW - 15, L.dlPipeY, 'S-TX');
    // Client Rx  → left edge of client, downlink pipe level
    this._meterGfx.cliRx = this._addMeter(stage, L.cliX + 1,            L.dlPipeY, 'C-RX');
    // Client Tx  → left edge of client, uplink pipe level
    this._meterGfx.cliTx = this._addMeter(stage, L.cliX + 1,            L.ulPipeY, 'C-TX');
    // Server Rx  → right edge of server, uplink pipe level
    this._meterGfx.srvRx = this._addMeter(stage, L.srvX + L.srvW - 15,  L.ulPipeY, 'S-RX');

    // Dynamic node info text — inside node bodies so they don't overlap pipes
    this._nodeInfoText.srvTx = this._makeInfoText(L.srvX + 8, L.srvY + 68,  '', 0x79c0ff);
    this._nodeInfoText.cliTx = this._makeInfoText(L.cliX + 8, L.cliY + 68,  '', 0xffa657);
    this._nodeInfoText.srvBuf= this._makeInfoText(L.srvX + 8, L.srvY + 84,  '', 0x8b949e);
    this._nodeInfoText.cliBuf= this._makeInfoText(L.cliX + 8, L.cliY + 84,  '', 0x8b949e);
    for (const t of Object.values(this._nodeInfoText)) stage.addChild(t);

    // Stats text top-center
    this._statsText = new PIXI.Text('', { fontFamily: 'Courier New', fontSize: 10, fill: C.textDim, lineHeight: 14 });
    this._statsText.x = L.pipeX0 + L.pipeLen/2 - 80;
    this._statsText.y = L.dlPipeY - 50;
    stage.addChild(this._statsText);

    // Drop particles (rendered on very top)
    this._drp = new PIXI.Graphics(); stage.addChild(this._drp);
  }

  // ── Per-frame update ───────────────────────────────────────
  update(dt) {
    const s   = this.sim.state;
    const cfg = this.sim.config;

    // Process & clear events from simulation
    const now = this.sim.time;
    for (const e of s.events) {
      if (e.type === 'drop') this._triggerDropEffect(e.dir, now);
    }
    s.events = [];

    // Particle physics
    const dlUtil = cfg.downlinkBandwidth > 0 ? s.dlThroughput / cfg.downlinkBandwidth : 0;
    const ulUtil = cfg.uplinkBandwidth   > 0 ? s.ulThroughput / cfg.uplinkBandwidth   : 0;
    const speed  = this._particleSpeed(cfg.linkLatency);

    this._tickParticles(this._dlParticles,  dt, dlUtil,  speed, 'dl');
    this._tickParticles(this._ulParticles,  dt, ulUtil, -speed, 'ul');
    this._tickDropParticles(dt);

    // Utilization pipe overlay
    this._drawUtilOverlay(dlUtil, ulUtil);

    // Buffer meters
    const srvTxFill = s.serverTxUsed / cfg.serverTxBuffer;
    const cliTxFill = s.clientTxUsed / cfg.clientTxBuffer;
    const cliRxFill = s.clientRxUsed / (cfg.serverTxBuffer * 8);
    const srvRxFill = s.serverRxUsed / (cfg.clientTxBuffer * 8);
    this._drawMeter(this._meterGfx.srvTx, srvTxFill, now);
    this._drawMeter(this._meterGfx.cliRx, Math.min(cliRxFill * 4, 1), now);
    this._drawMeter(this._meterGfx.cliTx, cliTxFill, now);
    this._drawMeter(this._meterGfx.srvRx, Math.min(srvRxFill * 4, 1), now);

    // Node info text
    this._nodeInfoText.srvTx.text = `TX: ${fmtMbps(s.dlThroughput)}`;
    this._nodeInfoText.cliTx.text = `TX: ${fmtMbps(s.ulThroughput)}`;
    this._nodeInfoText.srvBuf.text = `BUF: ${Math.round(srvTxFill * 100)}%`;
    this._nodeInfoText.cliBuf.text = `BUF: ${Math.round(cliTxFill * 100)}%`;

    // Draw particles
    this._drawParticles();
  }

  // ── Particle pool ──────────────────────────────────────────
  _makePool(n) {
    return Array.from({ length: n }, () => ({ x:0, y:0, vx:0, vy:0, alpha:1, active:false, life:1 }));
  }

  _particleSpeed(latencyMs) {
    // Higher latency = slower visual speed
    const traversalSec = Math.max(0.15, latencyMs * 0.015);
    return L.pipeLen / traversalSec;
  }

  _tickParticles(pool, dt, utilRatio, speed, dir) {
    const pipeY  = dir === 'dl' ? L.dlPipeY : L.ulPipeY;
    const startX = dir === 'dl' ? L.pipeX0  : L.pipeX1;
    const endX   = dir === 'dl' ? L.pipeX1  : L.pipeX0;

    // Move active particles
    for (const p of pool) {
      if (!p.active) continue;
      p.x += speed * dt;
      // Fade near pipe exit
      const dist = Math.abs(p.x - endX);
      if (dist < 30) p.alpha = dist / 30;
      if ((speed > 0 && p.x >= endX) || (speed < 0 && p.x <= endX)) {
        p.active = false;
      }
    }

    // Spawn new particles
    const target = Math.ceil(Math.min(utilRatio, 1.5) * 55);
    let active = pool.filter(p => p.active).length;
    const maxSpawn = Math.min(4, target - active);
    if (maxSpawn <= 0) return;

    let spawned = 0;
    for (const p of pool) {
      if (p.active) continue;
      if (spawned >= maxSpawn) break;
      p.active = true;
      p.x      = startX + (Math.random() * 10 - 5);
      p.y      = pipeY + 4 + Math.random() * (L.pipeH - 8);
      p.alpha  = 0.7 + Math.random() * 0.3;
      spawned++;
    }
  }

  _tickDropParticles(dt) {
    for (const p of this._dropParticles) {
      if (!p.active) continue;
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   += 300 * dt; // gravity
      p.life -= dt * 2.5;
      p.alpha = Math.max(0, p.life);
      if (p.life <= 0) p.active = false;
    }
  }

  _triggerDropEffect(dir, now) {
    const key = dir;
    if (now - this._lastDropEffect[key] < 180) return;
    this._lastDropEffect[key] = now;

    const x = dir === 'dl' ? L.pipeX0 + 5 : L.pipeX1 - 5;
    const y = dir === 'dl' ? L.dlPipeYc    : L.ulPipeYc;

    let spawned = 0;
    for (const p of this._dropParticles) {
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const spd   = 60 + Math.random() * 120;
      p.active = true;
      p.x      = x + (Math.random() - 0.5) * 12;
      p.y      = y + (Math.random() - 0.5) * 12;
      p.vx     = Math.cos(angle) * spd;
      p.vy     = Math.sin(angle) * spd - 40;
      p.alpha  = 1;
      p.life   = 1;
      if (++spawned >= 14) break;
    }
  }

  _drawParticles() {
    // Downlink particles
    this._dl.clear();
    for (const p of this._dlParticles) {
      if (!p.active) continue;
      this._dl.beginFill(C.dlParticle, p.alpha);
      this._dl.drawRect(p.x - 3, p.y - 2, 6, 4);
      this._dl.endFill();
    }

    // Uplink particles
    this._ul.clear();
    for (const p of this._ulParticles) {
      if (!p.active) continue;
      this._ul.beginFill(C.ulParticle, p.alpha);
      this._ul.drawRect(p.x - 3, p.y - 2, 6, 4);
      this._ul.endFill();
    }

    // Drop burst particles
    this._drp.clear();
    for (const p of this._dropParticles) {
      if (!p.active) continue;
      const sz = 2 + p.life * 2;
      this._drp.beginFill(C.dropParticle, p.alpha);
      this._drp.drawRect(p.x - sz/2, p.y - sz/2, sz, sz);
      this._drp.endFill();
    }
  }

  // ── Utilization overlay ────────────────────────────────────
  _drawUtilOverlay(dlUtil, ulUtil) {
    const g = this._utilGfx;
    g.clear();

    const drawOverlay = (pipeY, util, colorLow, colorHigh) => {
      const clamped = Math.min(util, 1);
      const tint    = util > 1 ? C.bufRed : lerpColor(colorLow, colorHigh, clamped);
      const alpha   = 0.1 + clamped * 0.35 + (util > 1 ? Math.sin(Date.now() * 0.008) * 0.15 : 0);
      g.beginFill(tint, Math.max(0, Math.min(1, alpha)));
      g.drawRoundedRect(L.pipeX0, pipeY, L.pipeLen * Math.min(clamped, 1), L.pipeH, 4);
      g.endFill();
    };

    drawOverlay(L.dlPipeY, dlUtil, 0x0d3a5c, 0x1565c0);
    drawOverlay(L.ulPipeY, ulUtil, 0x3d1a00, 0x7f3000);
  }

  // ── Buffer meter ───────────────────────────────────────────
  _addMeter(stage, x, pipeY, labelStr) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = pipeY;

    // Background
    const bg = new PIXI.Graphics();
    bg.beginFill(0x0a0a0f, 0.9);
    bg.lineStyle(1, 0x2a2a3a, 0.8);
    bg.drawRoundedRect(0, 0, L.meterW, L.meterH, 2);
    bg.endFill();
    container.addChild(bg);

    // Fill (dynamic — replaced each frame via the graphics object)
    const fill = new PIXI.Graphics();
    container.addChild(fill);

    // Label below
    const label = new PIXI.Text(labelStr, {
      fontFamily: 'Courier New', fontSize: 8, fill: C.textDim, align: 'center',
    });
    label.x = L.meterW / 2 - label.width / 2;
    label.y = L.meterH + 2;
    container.addChild(label);

    stage.addChild(container);
    return { container, fill };
  }

  _drawMeter(meter, fillRatio, now) {
    fillRatio = Math.max(0, Math.min(1, fillRatio));
    const g   = meter.fill;
    const isCritical = fillRatio > 0.92;
    const blink = isCritical && Math.sin(now * 0.015) > 0;
    const color = blink ? C.bufCritical : bufFillColor(fillRatio);
    const h     = Math.round(fillRatio * (L.meterH - 2));

    g.clear();
    if (h > 0) {
      g.beginFill(color, 0.9);
      g.drawRoundedRect(1, L.meterH - 1 - h, L.meterW - 2, h, 1);
      g.endFill();
    }
  }

  // ── Static scene helpers ───────────────────────────────────
  _makeGrid() {
    const g = new PIXI.Graphics();
    g.lineStyle(1, 0x161b22, 0.6);
    for (let x = 0; x <= L.W; x += 50) { g.moveTo(x, 0); g.lineTo(x, L.H); }
    for (let y = 0; y <= L.H; y += 50) { g.moveTo(0, y); g.lineTo(L.W, y); }
    return g;
  }

  _drawNode(g, x, y, w, h, fillColor, borderColor) {
    g.lineStyle(2, borderColor, 1);
    g.beginFill(fillColor, 1);
    g.drawRoundedRect(x, y, w, h, 6);
    g.endFill();

    // Port nubs on edges
    const nubY = [L.dlPipeYc, L.ulPipeYc];
    for (const ny of nubY) {
      const isLeft = x < L.W / 2;
      const nx = isLeft ? x + w - 2 : x + 2;
      g.beginFill(borderColor, 0.7);
      g.drawRoundedRect(nx - 4, ny - 5, 8, 10, 2);
      g.endFill();
    }
  }

  _makeNodeLabel(cx, y, text, color) {
    const t = new PIXI.Text(text, { fontFamily: 'Segoe UI', fontWeight: 'bold', fontSize: 13, fill: color });
    t.x = cx - t.width / 2;
    t.y = y - t.height / 2;
    return t;
  }

  _makeSubLabel(cx, y, text) {
    const t = new PIXI.Text(text, { fontFamily: 'Courier New', fontSize: 9, fill: C.textDim });
    t.x = cx - t.width / 2;
    t.y = y - t.height / 2;
    return t;
  }

  _makeInfoText(x, y, text, color) {
    const t = new PIXI.Text(text, { fontFamily: 'Courier New', fontSize: 10, fill: color });
    t.x = x;
    t.y = y;
    return t;
  }

  _makePipeLabels() {
    const c = new PIXI.Container();

    const addLabel = (x, y, text, color) => {
      const t = new PIXI.Text(text, { fontFamily: 'Segoe UI', fontSize: 10, fill: color });
      t.x = x; t.y = y;
      c.addChild(t);
    };

    const mx = L.pipeX0 + L.pipeLen / 2;
    addLabel(mx - 60, L.dlPipeY - 18, '▶  Downlink  (Server → Client)', 0x4a90d9);
    addLabel(mx - 60, L.ulPipeY + L.pipeH + 5, '◀  Uplink   (Client → Server)', 0xc87941);

    // Mid-pipe BW indicator text
    this._dlBwText = new PIXI.Text('', { fontFamily: 'Courier New', fontSize: 10, fill: 0x4fc3f7, align: 'center' });
    this._ulBwText = new PIXI.Text('', { fontFamily: 'Courier New', fontSize: 10, fill: 0xffb74d, align: 'center' });
    this._dlBwText.x = mx - 40; this._dlBwText.y = L.dlPipeYc - 6;
    this._ulBwText.x = mx - 40; this._ulBwText.y = L.ulPipeYc - 6;
    c.addChild(this._dlBwText);
    c.addChild(this._ulBwText);
    return c;
  }

  // Called from main to update BW labels when config changes
  updateBwLabels(dlBw, ulBw) {
    if (this._dlBwText) this._dlBwText.text = fmtMbps(dlBw) + ' max';
    if (this._ulBwText) this._ulBwText.text = fmtMbps(ulBw) + ' max';
  }
}


// ── Colour utilities ───────────────────────────────────────────
function lerpColor(c1, c2, t) {
  const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
  return ((Math.round(r1 + (r2-r1)*t) << 16) |
          (Math.round(g1 + (g2-g1)*t) <<  8) |
           Math.round(b1 + (b2-b1)*t));
}

function bufFillColor(r) {
  if (r < 0.5) return lerpColor(C.bufGreen, C.bufAmber, r * 2);
  return lerpColor(C.bufAmber, C.bufRed, (r - 0.5) * 2);
}

function fmtMbps(mbps) {
  if (mbps >= 1000) return (mbps / 1000).toFixed(1) + ' Gbps';
  if (mbps >= 1)    return mbps.toFixed(1) + ' Mbps';
  return (mbps * 1000).toFixed(0) + ' Kbps';
}
