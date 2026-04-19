'use strict';

class Simulation {
  constructor() {
    this.config = {
      serverSendRate:    200,      // Mbps
      clientSendRate:    5,        // Mbps
      downlinkBandwidth: 100,      // Mbps
      uplinkBandwidth:   10,       // Mbps
      serverTxBuffer:    524288,   // bytes  (512 KB)
      clientTxBuffer:    65536,    // bytes  (64 KB)
      linkLatency:       20,       // ms
    };

    this.time          = 0;   // simulation ms
    this._lastHistTime = -1e9;
    this.HIST_MS       = 500;

    this.state   = this._makeState();
    this.history = [];
  }

  // ── State factory ───────────────────────────────────────────
  _makeState() {
    return {
      // Tx buffers (egress queues — where congestion & drops occur)
      serverTxUsed: 0,  // bytes
      clientTxUsed: 0,

      // Rx buffers (ingress — drain quickly, mostly visual)
      clientRxUsed: 0,
      serverRxUsed: 0,

      // Current throughput (Mbps, per-tick instantaneous)
      dlThroughput: 0,
      ulThroughput: 0,
      dlRxThroughput: 0,
      ulRxThroughput: 0,

      // Drop rate accumulator for this history interval (bytes)
      _dlDropAcc: 0,
      _ulDropAcc: 0,

      // Lifetime totals (bytes)
      dlDropTotal: 0,
      ulDropTotal: 0,

      // In-transit packets: [{bytes, arrivalTime}]
      dlTransit: [],
      ulTransit: [],

      // Events consumed by the renderer each frame, then cleared
      events: [],
    };
  }

  // ── Per-frame tick ──────────────────────────────────────────
  tick(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);          // clamp to avoid huge jumps

    this.time += dt * 1000;
    const s   = this.state;
    const cfg = this.config;
    const B   = mbps => mbps * 125000; // Mbps → bytes/sec

    // 1. Generate traffic → Tx buffers ─────────────────────────
    this._enqueue(s, B(cfg.serverSendRate) * dt, 'dl', dt);
    this._enqueue(s, B(cfg.clientSendRate) * dt, 'ul', dt);

    // 2. Dequeue Tx buffers → in-transit ───────────────────────
    const dlCap  = B(cfg.downlinkBandwidth) * dt;
    const ulCap  = B(cfg.uplinkBandwidth)   * dt;
    const dlSent = Math.min(s.serverTxUsed, dlCap);
    const ulSent = Math.min(s.clientTxUsed, ulCap);

    s.serverTxUsed  -= dlSent;
    s.clientTxUsed  -= ulSent;
    s.dlThroughput   = dlSent / dt / 125000;
    s.ulThroughput   = ulSent / dt / 125000;

    if (dlSent > 0) s.dlTransit.push({ bytes: dlSent, arrivalTime: this.time + cfg.linkLatency });
    if (ulSent > 0) s.ulTransit.push({ bytes: ulSent, arrivalTime: this.time + cfg.linkLatency });

    // 3. Deliver arrived packets → Rx buffers ──────────────────
    const dlRxMax = cfg.serverTxBuffer * 8;
    const ulRxMax = cfg.clientTxBuffer * 8;
    let dlDelivered = 0, ulDelivered = 0;

    s.dlTransit = s.dlTransit.filter(pkt => {
      if (pkt.arrivalTime > this.time) return true;
      const space = dlRxMax - s.clientRxUsed - dlDelivered;
      dlDelivered += Math.min(pkt.bytes, Math.max(0, space));
      return false;
    });
    s.ulTransit = s.ulTransit.filter(pkt => {
      if (pkt.arrivalTime > this.time) return true;
      const space = ulRxMax - s.serverRxUsed - ulDelivered;
      ulDelivered += Math.min(pkt.bytes, Math.max(0, space));
      return false;
    });

    s.clientRxUsed = Math.min(s.clientRxUsed + dlDelivered, dlRxMax);
    s.serverRxUsed = Math.min(s.serverRxUsed + ulDelivered, ulRxMax);

    // 4. Drain Rx buffers ──────────────────────────────────────
    const dlDrain = Math.min(s.clientRxUsed, B(cfg.downlinkBandwidth * 1.5) * dt);
    const ulDrain = Math.min(s.serverRxUsed, B(cfg.uplinkBandwidth   * 1.5) * dt);
    s.clientRxUsed    -= dlDrain;
    s.serverRxUsed    -= ulDrain;
    s.dlRxThroughput   = dlDrain / dt / 125000;
    s.ulRxThroughput   = ulDrain / dt / 125000;

    // 5. Record history sample ─────────────────────────────────
    if (this.time - this._lastHistTime >= this.HIST_MS) {
      const elapsed = (this.time - this._lastHistTime) / 1000;
      this.history.push({
        time:        this.time / 1000,                              // seconds
        dlThru:      s.dlThroughput,
        dlDropRate:  s._dlDropAcc / elapsed / 125000,
        ulThru:      s.ulThroughput,
        ulDropRate:  s._ulDropAcc / elapsed / 125000,
      });
      s._dlDropAcc = 0;
      s._ulDropAcc = 0;
      this._lastHistTime = this.time;
      if (this.history.length > 120) this.history = this.history.slice(-120);
    }
  }

  // ── Enqueue helper ──────────────────────────────────────────
  _enqueue(s, bytes, dir, dt) {
    const isDownlink = dir === 'dl';
    const bufUsedKey = isDownlink ? 'serverTxUsed' : 'clientTxUsed';
    const bufMaxKey  = isDownlink ? 'serverTxBuffer' : 'clientTxBuffer';
    const dropAccKey = isDownlink ? '_dlDropAcc' : '_ulDropAcc';
    const dropTotKey = isDownlink ? 'dlDropTotal' : 'ulDropTotal';

    const maxBuf = this.config[bufMaxKey];
    const space  = maxBuf - s[bufUsedKey];
    const queued = Math.min(bytes, space);
    const dropped = bytes - queued;

    s[bufUsedKey] += queued;

    if (dropped > 0) {
      s[dropAccKey] += dropped;
      s[dropTotKey] += dropped;
      s.events.push({ type: 'drop', dir, bytes: dropped, time: this.time });
    }
  }

  // ── Config update ────────────────────────────────────────────
  setConfig(patch) {
    Object.assign(this.config, patch);
    // Clamp buffer used to new max
    this.state.serverTxUsed = Math.min(this.state.serverTxUsed, this.config.serverTxBuffer);
    this.state.clientTxUsed = Math.min(this.state.clientTxUsed, this.config.clientTxBuffer);
  }

  reset() {
    this.time          = 0;
    this._lastHistTime = -1e9;
    this.state         = this._makeState();
    this.history       = [];
  }
}
