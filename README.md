# Britain Transit Network

An interactive, full-stack multimodal transit network map built with **React**, **TypeScript**, **Tailwind CSS**, **MapLibre GL**, **deck.gl**, and an **Express** live-data proxy. Created for **#30DayMapChallenge — Day 24: "Network"**, the application models regional rail trunks, express coach corridors, and feeder links across Great Britain while integrating real-time UK service statuses and train arrival telemetry.

---

## Features

### 1. Live Great Britain Transit Telemetry (`/api/transit/*`)
- **Real-Time Operator Statuses:** Connects server-side to the TfL Unified & National Rail Status API (`/Line/Mode/national-rail,elizabeth-line,overground,tube,dlr/Status`) across 44 UK rail and metro operators (including Avanti West Coast, LNER, GWR, CrossCountry, ScotRail, TransPennine Express, East Midlands Railway, Greater Anglia, Northern, Transport for Wales, Thameslink, and Elizabeth line).
- **Delay-Adjusted Routing:** Automatically applies delay multipliers (`+15%` for Minor Delays, `+35%` for Severe Delays / Part Closure) to affected UK corridors when **Live Status** and **Delay Routing** are enabled.
- **Live Train Arrivals:** Streams real-time countdown arrival predictions for the Elizabeth line and London Underground corridors in the **Live Feed** tab.
- **Graceful Baseline Fallback:** Caches upstream responses for 30 seconds in memory and falls back cleanly to the baseline schedule if the upstream API is unavailable.

### 2. Multimodal 3D & 2D Network Visualization
- **Animated Corridor Flow:** Curved 3D arcs with directional flow particles scaled by daily passenger demand (`ridershipOrFlow`) and colored by transit mode (`rail`, `express`, `feeder`) or a **Travel Time** speed gradient.
- **Interactive Filtering:** Toggle transit modes independently, adjust minimum daily passenger flow thresholds, switch between `Flow Volume` and `Travel Time` styling, pause/resume flow animation, and toggle `3D` tilted arcs vs. flat `2D` blueprint projection across Dark and Light basemaps.
- **Hover Tooltips:** Inspect corridor travel time, hourly frequency, daily flow, live operator name/status, and station node degree/throughput.

### 3. Shortest-Path Routing, Hops & Contingency Stress-Testing
- **Dijkstra Shortest Path:** Computes minimum-time routes between any Origin and Destination with leg-by-leg breakdown, transfer counts, headways, and cumulative arrival times (supports both bidirectional and directed graph modes).
- **1-Hop & 2-Hop Neighborhood Inspection:** Click any hub or station node to highlight direct 1-hop corridors and single-transfer 2-hop reachability.
- **Corridor Resilience & Disruption Simulation:** Temporarily close one or more high-demand corridors from the **Resilience** tab (or route leg controls) to measure exact `+min` rerouting penalties and displaced daily passenger flow.

### 4. Auto-Playing Product Tour & Open GIS Interoperability
- **8-Step Auto-Playing Product Tour:** Guided executive walkthrough covering network flow, live GB telemetry, demand thresholding, 1-hop/2-hop connectivity, shortest-path optimization, disruption stress-testing, cartography modes, and GeoJSON ingestion.
- **Custom Data Import / Export:** Upload or paste any custom **GeoJSON `FeatureCollection`** or `{ nodes, edges }` JSON graph, and export the active network as `.geojson`.

---

## Live Data vs. Baseline Dataset

| Layer | Source | Refresh / Coverage |
| --- | --- | --- |
| **Operator Status & Disruption Notices** | Live TfL Unified & National Rail API | Polled every 45s (30s server cache) across 44 UK operators |
| **Live Vehicle Arrivals** | Live TfL Unified Arrivals API | On-demand & polled for Elizabeth line and London Underground lines |
| **Network Topology & Demand** | Built-in UK baseline dataset (or user-imported GeoJSON/JSON) | 26 hub/stop nodes and 49 multimodal corridors (`travelMinutes`, `frequencyPerHour`, `ridershipOrFlow`) |

---

## Graph Data Schema

Custom JSON imports support either a GeoJSON `FeatureCollection` (with `Point` nodes and `LineString` edges) or a graph object:

```ts
export interface NetworkNode {
  id: string;
  name: string;
  hubTier: 'interchange' | 'stop';
  coordinates: [number, number]; // [lng, lat]
}

export interface NetworkEdge {
  id: string;
  fromNode: string;
  toNode: string;
  mode: 'rail' | 'express' | 'feeder';
  travelMinutes: number;
  frequencyPerHour: number;
  ridershipOrFlow: number;
}
```

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Geospatial Engine:** MapLibre GL + deck.gl (`@deck.gl/mapbox`, `PathLayer`, `ScatterplotLayer`, `TextLayer`)
- **Backend Proxy:** Node.js + Express (`server.ts`) with Vite middleware in development

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables (Optional)
Copy `.env.example` to `.env` if you want to supply a dedicated Transport for London API key for higher rate limits (500 requests/min). The TfL `Line` endpoints also work anonymously without a key.

```env
TFL_APP_KEY=""
```

### 3. Run in Development
Starts the Express API proxy and Vite dev server on port `3000`:
```bash
npm run dev
```

### 4. Typecheck & Production Build
```bash
npm run lint
npm run build
npm start
```

---

## API Endpoints

- `GET /api/transit/live` — Returns aggregated live status for 44 UK rail/metro lines, active disruption notices, and Elizabeth line arrival telemetry. Append `?refresh=1` to bypass the 30s server cache.
- `GET /api/transit/arrivals/:lineId` — Returns the next 20 sorted live arrival predictions for a specific line ID (e.g., `elizabeth`, `central`, `northern`, `piccadilly`, `jubilee`, `victoria`).
