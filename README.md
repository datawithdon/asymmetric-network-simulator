# Asymmetric Network Simulator

A browser-based, real-time visualisation of asymmetric network congestion — showing how unequal port capacities cause buffer build-up, packet drops, and latency spikes in one direction while the other stays clear.

**Live demo:** *(open `index.html` in any modern browser — no install required)*

---

## Preview

> Two parallel pipes represent the downlink and uplink independently.  
> Particles flow through each pipe, buffer meters fill from green → red, and drop-burst effects fire when queues overflow.

---

## Features

| Feature | Detail |
|---|---|
| **WebGL rendering** | Pixi.js v7 — smooth 60 fps particle animation |
| **Split-pipe view** | Downlink and uplink shown as separate, independent channels |
| **Particle flow** | Density = utilisation · Speed = link latency |
| **Buffer meters** | 4 fill gauges (S-TX, C-RX, C-TX, S-RX) — green → amber → red → blink at >92% |
| **Drop bursts** | Red scatter particles explode at the congested Tx port on overflow |
| **Real-time charts** | Chart.js v4 — throughput vs drop-rate for both directions |
| **Log-scale sliders** | Covers 1 Mbps → 10 Gbps cleanly |
| **Presets** | ADSL Overload · SAN Bottleneck · Symmetric LAN · Idle |
| **Playback controls** | Play · Pause · Step-forward · Reset · 1× / 2× / 5× speed |

---

## Getting Started

### Option 1 — Open directly (no server needed)

```
Double-click index.html
```

Requires an internet connection on first load to pull CDN libraries (Pixi.js + Chart.js). After that they are cached.

### Option 2 — Live Server (VS Code)

1. Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
2. Open the `network-sim` folder in VS Code
3. Right-click `index.html` → **Open with Live Server**

---

## How to Use

### Presets (quickest way to see congestion)

| Preset | What it shows |
|---|---|
| **ADSL Overload** | 30 Mbps traffic into a 20 Mbps downlink + 3 Mbps into 1 Mbps uplink — both directions drop |
| **SAN Bottleneck** | 2.5 Gbps write traffic saturating a 1 Gbps storage link |
| **Symmetric LAN** | 600 Mbps each way through 1 Gbps links — no congestion |
| **Idle** | Low traffic baseline |

### Controls

| Control | Effect |
|---|---|
| **Server → Client Rate** slider | How fast the server generates traffic (can exceed downlink BW to force drops) |
| **Client → Server Rate** slider | How fast the client generates traffic (can exceed uplink BW) |
| **Downlink / Uplink Max BW** | The physical link capacity for each direction |
| **Server / Client Tx Buffer** | Queue size — smaller buffer = earlier drops at lower load |
| **Link Latency** | Higher latency = slower particles traversing the pipe |
| **Play / Pause / Step** | Step advances one frame at a time so you can inspect queue state |
| **1× / 2× / 5×** | Simulation speed multiplier |

### Reading the Visualisation

```
[SERVER]  ──▶ S-TX meter ──[ Downlink pipe ]──▶ C-RX meter ──  [CLIENT]
          ◀── S-RX meter ◀─[ Uplink pipe  ]──── C-TX meter ◀──
```

- **S-TX** fills when the server generates faster than the downlink bandwidth → drops fire here
- **C-TX** fills when the client generates faster than the uplink bandwidth → drops fire there
- **Rx meters** show how much data is arriving at the far end

---

## Project Structure

```
network-sim/
├── index.html          # Shell — layout, CDN script tags
├── css/
│   └── style.css       # Dark theme, flex layout
└── js/
    ├── simulation.js   # Tick-based engine (buffers, drops, in-transit queue, history)
    ├── renderer.js     # Pixi.js WebGL scene (particles, meters, overlays)
    ├── charts.js       # Chart.js real-time throughput / drop-rate graphs
    └── main.js         # Wires everything — sliders, presets, playback, status bar
```

**No build step. No framework. No dependencies to install.**  
All libraries load from CDN at runtime.

---

## Dependencies (CDN, no install)

| Library | Version | Purpose |
|---|---|---|
| [Pixi.js](https://pixijs.com) | 7.3.2 | WebGL 2D rendering engine |
| [Chart.js](https://www.chartjs.org) | 4.4.0 | Real-time line charts |

---

## Simulation Model

Each tick (1/60 s × speed multiplier):

1. **Traffic generation** → bytes enqueued into each direction's Tx buffer
2. **Dequeue** → bytes drained from Tx buffer onto the link, capped at link bandwidth
3. **Transit** → packets travel the link for `linkLatency` ms before arriving
4. **Delivery** → arrived bytes enqueued into Rx buffer
5. **Rx drain** → application consumes data from Rx buffer
6. **Drop accounting** → any bytes that arrive when a Tx buffer is full are counted as dropped and trigger a visual burst effect

---

## License

MIT — see [LICENSE](LICENSE)
