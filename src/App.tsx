/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Copy,
  Download,
  FileUp,
  Layers,
  MapPin,
  Moon,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Route,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  TrainFront,
  Upload,
  X,
} from 'lucide-react';

// ============================================================================
// 1. TypeScript Interfaces & Domain Types
// ============================================================================

export type TransitMode = 'rail' | 'express' | 'feeder';
export type HubTier = 'interchange' | 'stop';
export type EdgeStyleMode = 'flow' | 'travelTime';
export type InspectorTab = 'routing' | 'live' | 'resilience';

interface LiveOperatorStatus {
  id: string;
  name: string;
  modeName: string;
  severity: number;
  statusDescription: string;
  reason: string | null;
}

interface LiveArrivalSample {
  vehicleId: string;
  stationName: string;
  destinationName: string;
  towards: string;
  currentLocation: string;
  minutesAway: number;
  expectedArrival: string;
}

interface LiveTransitPayload {
  liveAvailable: boolean;
  source: string;
  fetchedAt: string;
  cached: boolean;
  operators: LiveOperatorStatus[];
  summary: {
    totalLines: number;
    goodServiceCount: number;
    degradedCount: number;
    activeIncidents: LiveOperatorStatus[];
  };
  elizabethTelemetry: {
    activePredictions: number;
    trackedVehicles: number;
    upcomingArrivals: LiveArrivalSample[];
  };
  error?: string;
}

interface LiveCorridorTelemetry {
  operatorId: string;
  operatorName: string;
  severity: number;
  statusDescription: string;
  reason: string | null;
  delayMultiplier: number;
}

export interface NetworkNode {
  id: string;
  name: string;
  hubTier: HubTier;
  coordinates: [number, number]; // [lng, lat]
}

export interface NetworkEdge {
  id: string;
  fromNode: string;
  toNode: string;
  mode: TransitMode;
  travelMinutes: number;
  frequencyPerHour: number;
  ridershipOrFlow: number;
}

export interface NetworkDataset {
  name: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface PathStep {
  edge: NetworkEdge;
  from: NetworkNode;
  to: NetworkNode;
  cumulativeMinutes: number;
}

export interface PathResult {
  origin: NetworkNode;
  destination: NetworkNode;
  reachable: boolean;
  totalMinutes: number;
  transfers: number;
  steps: PathStep[];
  nodeIds: string[];
  edgeIds: string[];
}

interface HopAnalysis {
  centerNodeId: string;
  hop1NodeIds: Set<string>;
  hop2NodeIds: Set<string>;
  hop1EdgeIds: Set<string>;
  hop2EdgeIds: Set<string>;
  hop1Connections: Array<{
    node: NetworkNode;
    edge: NetworkEdge;
    direction: 'outbound' | 'inbound';
  }>;
  hop2Nodes: NetworkNode[];
}

interface CurvedEdgeGeometry {
  edge: NetworkEdge;
  from: NetworkNode;
  to: NetworkNode;
  path: [number, number, number][];
}

interface FlowParticle {
  position: [number, number, number];
  color: [number, number, number, number];
  radius: number;
  edgeId: string;
}

type HoverTarget =
  | {
      kind: 'node';
      node: NetworkNode;
      x: number;
      y: number;
    }
  | {
      kind: 'edge';
      edge: NetworkEdge;
      from: NetworkNode;
      to: NetworkNode;
      x: number;
      y: number;
    };

interface TourStepDefinition {
  id: string;
  category: string;
  title: string;
  description: string;
  audienceNote: string;
  camera?: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  };
}

// ============================================================================
// 2. Built-in UK Regional Multimodal Transit Network Dataset
// ============================================================================

const INITIAL_UK_NETWORK: NetworkDataset = {
  name: 'Great Britain Transit Network',
  nodes: [
    { id: 'london', name: 'London Euston / King’s Cross', hubTier: 'interchange', coordinates: [-0.129, 51.5308] },
    { id: 'birmingham', name: 'Birmingham New Street', hubTier: 'interchange', coordinates: [-1.8986, 52.4778] },
    { id: 'manchester', name: 'Manchester Piccadilly', hubTier: 'interchange', coordinates: [-2.2309, 53.4774] },
    { id: 'leeds', name: 'Leeds City', hubTier: 'interchange', coordinates: [-1.5476, 53.7949] },
    { id: 'edinburgh', name: 'Edinburgh Waverley', hubTier: 'interchange', coordinates: [-3.1883, 55.9521] },
    { id: 'glasgow', name: 'Glasgow Central', hubTier: 'interchange', coordinates: [-4.2581, 55.8591] },
    { id: 'bristol', name: 'Bristol Temple Meads', hubTier: 'interchange', coordinates: [-2.5811, 51.4492] },
    { id: 'cardiff', name: 'Cardiff Central', hubTier: 'interchange', coordinates: [-3.1791, 51.4759] },
    { id: 'york', name: 'York Station', hubTier: 'interchange', coordinates: [-1.0932, 53.958] },
    { id: 'newcastle', name: 'Newcastle Central', hubTier: 'interchange', coordinates: [-1.6172, 54.9686] },
    { id: 'sheffield', name: 'Sheffield Midland', hubTier: 'interchange', coordinates: [-1.4622, 53.3781] },
    { id: 'reading', name: 'Reading', hubTier: 'stop', coordinates: [-0.9718, 51.4587] },
    { id: 'oxford', name: 'Oxford', hubTier: 'stop', coordinates: [-1.2702, 51.7534] },
    { id: 'cambridge', name: 'Cambridge', hubTier: 'stop', coordinates: [0.1373, 52.1943] },
    { id: 'norwich', name: 'Norwich', hubTier: 'stop', coordinates: [1.3071, 52.627] },
    { id: 'nottingham', name: 'Nottingham', hubTier: 'stop', coordinates: [-1.147, 52.9471] },
    { id: 'liverpool', name: 'Liverpool Lime Street', hubTier: 'stop', coordinates: [-2.9773, 53.4076] },
    { id: 'preston', name: 'Preston', hubTier: 'stop', coordinates: [-2.7073, 53.7556] },
    { id: 'carlisle', name: 'Carlisle', hubTier: 'stop', coordinates: [-2.9336, 54.8908] },
    { id: 'exeter', name: 'Exeter St Davids', hubTier: 'stop', coordinates: [-3.5435, 50.7294] },
    { id: 'plymouth', name: 'Plymouth', hubTier: 'stop', coordinates: [-4.1436, 50.3775] },
    { id: 'aberdeen', name: 'Aberdeen', hubTier: 'stop', coordinates: [-2.0985, 57.1435] },
    { id: 'inverness', name: 'Inverness', hubTier: 'stop', coordinates: [-4.2233, 57.4803] },
    { id: 'heathrow', name: 'Heathrow Airport Hub', hubTier: 'stop', coordinates: [-0.4543, 51.47] },
    { id: 'milton_keynes', name: 'Milton Keynes Central', hubTier: 'stop', coordinates: [-0.7745, 52.0345] },
    { id: 'brighton', name: 'Brighton', hubTier: 'stop', coordinates: [-0.1412, 50.8289] },
  ],
  edges: [
    // Rail Corridors
    { id: 'r-lon-mk', fromNode: 'london', toNode: 'milton_keynes', mode: 'rail', travelMinutes: 33, frequencyPerHour: 6, ridershipOrFlow: 28400 },
    { id: 'r-mk-bhm', fromNode: 'milton_keynes', toNode: 'birmingham', mode: 'rail', travelMinutes: 52, frequencyPerHour: 4, ridershipOrFlow: 24600 },
    { id: 'r-bhm-man', fromNode: 'birmingham', toNode: 'manchester', mode: 'rail', travelMinutes: 86, frequencyPerHour: 3, ridershipOrFlow: 22100 },
    { id: 'r-man-pre', fromNode: 'manchester', toNode: 'preston', mode: 'rail', travelMinutes: 42, frequencyPerHour: 3, ridershipOrFlow: 15800 },
    { id: 'r-pre-car', fromNode: 'preston', toNode: 'carlisle', mode: 'rail', travelMinutes: 68, frequencyPerHour: 2, ridershipOrFlow: 11400 },
    { id: 'r-car-gla', fromNode: 'carlisle', toNode: 'glasgow', mode: 'rail', travelMinutes: 72, frequencyPerHour: 2, ridershipOrFlow: 12900 },
    { id: 'r-car-edi', fromNode: 'carlisle', toNode: 'edinburgh', mode: 'rail', travelMinutes: 76, frequencyPerHour: 1.5, ridershipOrFlow: 9800 },
    { id: 'r-lon-cam', fromNode: 'london', toNode: 'cambridge', mode: 'rail', travelMinutes: 49, frequencyPerHour: 4, ridershipOrFlow: 26500 },
    { id: 'r-cam-nor', fromNode: 'cambridge', toNode: 'norwich', mode: 'rail', travelMinutes: 74, frequencyPerHour: 1.5, ridershipOrFlow: 7400 },
    { id: 'r-lon-yrk', fromNode: 'london', toNode: 'york', mode: 'rail', travelMinutes: 112, frequencyPerHour: 3, ridershipOrFlow: 31200 },
    { id: 'r-yrk-ncl', fromNode: 'york', toNode: 'newcastle', mode: 'rail', travelMinutes: 58, frequencyPerHour: 3, ridershipOrFlow: 19800 },
    { id: 'r-ncl-edi', fromNode: 'newcastle', toNode: 'edinburgh', mode: 'rail', travelMinutes: 88, frequencyPerHour: 2, ridershipOrFlow: 18400 },
    { id: 'r-edi-gla', fromNode: 'edinburgh', toNode: 'glasgow', mode: 'rail', travelMinutes: 48, frequencyPerHour: 6, ridershipOrFlow: 34500 },
    { id: 'r-edi-abd', fromNode: 'edinburgh', toNode: 'aberdeen', mode: 'rail', travelMinutes: 142, frequencyPerHour: 1, ridershipOrFlow: 6800 },
    { id: 'r-edi-inv', fromNode: 'edinburgh', toNode: 'inverness', mode: 'rail', travelMinutes: 205, frequencyPerHour: 0.5, ridershipOrFlow: 4100 },
    { id: 'r-abd-inv', fromNode: 'aberdeen', toNode: 'inverness', mode: 'rail', travelMinutes: 135, frequencyPerHour: 0.5, ridershipOrFlow: 2900 },
    { id: 'r-lon-rdg', fromNode: 'london', toNode: 'reading', mode: 'rail', travelMinutes: 25, frequencyPerHour: 8, ridershipOrFlow: 39200 },
    { id: 'r-rdg-brs', fromNode: 'reading', toNode: 'bristol', mode: 'rail', travelMinutes: 66, frequencyPerHour: 3, ridershipOrFlow: 21700 },
    { id: 'r-brs-cdf', fromNode: 'bristol', toNode: 'cardiff', mode: 'rail', travelMinutes: 48, frequencyPerHour: 3, ridershipOrFlow: 17900 },
    { id: 'r-brs-exe', fromNode: 'bristol', toNode: 'exeter', mode: 'rail', travelMinutes: 55, frequencyPerHour: 2, ridershipOrFlow: 12400 },
    { id: 'r-exe-ply', fromNode: 'exeter', toNode: 'plymouth', mode: 'rail', travelMinutes: 58, frequencyPerHour: 1.5, ridershipOrFlow: 7600 },
    { id: 'r-rdg-oxf', fromNode: 'reading', toNode: 'oxford', mode: 'rail', travelMinutes: 26, frequencyPerHour: 4, ridershipOrFlow: 16800 },
    { id: 'r-oxf-bhm', fromNode: 'oxford', toNode: 'birmingham', mode: 'rail', travelMinutes: 68, frequencyPerHour: 2, ridershipOrFlow: 13200 },
    { id: 'r-lon-btn', fromNode: 'london', toNode: 'brighton', mode: 'rail', travelMinutes: 58, frequencyPerHour: 5, ridershipOrFlow: 29400 },
    { id: 'r-bhm-shf', fromNode: 'birmingham', toNode: 'sheffield', mode: 'rail', travelMinutes: 72, frequencyPerHour: 2, ridershipOrFlow: 14600 },
    { id: 'r-shf-lds', fromNode: 'sheffield', toNode: 'leeds', mode: 'rail', travelMinutes: 40, frequencyPerHour: 3, ridershipOrFlow: 18200 },
    { id: 'r-lds-yrk', fromNode: 'leeds', toNode: 'york', mode: 'rail', travelMinutes: 24, frequencyPerHour: 4, ridershipOrFlow: 20400 },
    { id: 'r-man-lds', fromNode: 'manchester', toNode: 'leeds', mode: 'rail', travelMinutes: 54, frequencyPerHour: 4, ridershipOrFlow: 25800 },
    { id: 'r-man-liv', fromNode: 'manchester', toNode: 'liverpool', mode: 'rail', travelMinutes: 35, frequencyPerHour: 5, ridershipOrFlow: 27300 },
    { id: 'r-shf-not', fromNode: 'sheffield', toNode: 'nottingham', mode: 'rail', travelMinutes: 52, frequencyPerHour: 2, ridershipOrFlow: 10900 },
    { id: 'r-not-lon', fromNode: 'nottingham', toNode: 'london', mode: 'rail', travelMinutes: 104, frequencyPerHour: 2, ridershipOrFlow: 16400 },

    // Express Coach / Rapid Intercity Bus Corridors
    { id: 'e-lon-lhr', fromNode: 'london', toNode: 'heathrow', mode: 'express', travelMinutes: 35, frequencyPerHour: 6, ridershipOrFlow: 31800 },
    { id: 'e-lhr-rdg', fromNode: 'heathrow', toNode: 'reading', mode: 'express', travelMinutes: 38, frequencyPerHour: 4, ridershipOrFlow: 14200 },
    { id: 'e-lhr-oxf', fromNode: 'heathrow', toNode: 'oxford', mode: 'express', travelMinutes: 72, frequencyPerHour: 3, ridershipOrFlow: 11500 },
    { id: 'e-lhr-btn', fromNode: 'heathrow', toNode: 'brighton', mode: 'express', travelMinutes: 95, frequencyPerHour: 2, ridershipOrFlow: 8900 },
    { id: 'e-bhm-not', fromNode: 'birmingham', toNode: 'nottingham', mode: 'express', travelMinutes: 70, frequencyPerHour: 2, ridershipOrFlow: 9400 },
    { id: 'e-cam-oxf', fromNode: 'cambridge', toNode: 'oxford', mode: 'express', travelMinutes: 130, frequencyPerHour: 1.5, ridershipOrFlow: 6700 },
    { id: 'e-cam-mk', fromNode: 'cambridge', toNode: 'milton_keynes', mode: 'express', travelMinutes: 65, frequencyPerHour: 2, ridershipOrFlow: 7900 },
    { id: 'e-brs-bhm', fromNode: 'bristol', toNode: 'birmingham', mode: 'express', travelMinutes: 115, frequencyPerHour: 1.5, ridershipOrFlow: 8600 },
    { id: 'e-lds-ncl', fromNode: 'leeds', toNode: 'newcastle', mode: 'express', travelMinutes: 125, frequencyPerHour: 1, ridershipOrFlow: 6200 },
    { id: 'e-gla-abd', fromNode: 'glasgow', toNode: 'aberdeen', mode: 'express', travelMinutes: 175, frequencyPerHour: 1, ridershipOrFlow: 5400 },
    { id: 'e-cdf-bhm', fromNode: 'cardiff', toNode: 'birmingham', mode: 'express', travelMinutes: 135, frequencyPerHour: 1, ridershipOrFlow: 5900 },

    // Regional Feeder & Airport Shuttle Corridors
    { id: 'f-rdg-lhr', fromNode: 'reading', toNode: 'heathrow', mode: 'feeder', travelMinutes: 42, frequencyPerHour: 3, ridershipOrFlow: 9100 },
    { id: 'f-liv-pre', fromNode: 'liverpool', toNode: 'preston', mode: 'feeder', travelMinutes: 52, frequencyPerHour: 2, ridershipOrFlow: 6400 },
    { id: 'f-yrk-shf', fromNode: 'york', toNode: 'sheffield', mode: 'feeder', travelMinutes: 68, frequencyPerHour: 1.5, ridershipOrFlow: 5800 },
    { id: 'f-gla-pre', fromNode: 'glasgow', toNode: 'preston', mode: 'feeder', travelMinutes: 155, frequencyPerHour: 0.5, ridershipOrFlow: 3200 },
    { id: 'f-exe-cdf', fromNode: 'exeter', toNode: 'cardiff', mode: 'feeder', travelMinutes: 128, frequencyPerHour: 1, ridershipOrFlow: 4300 },
    { id: 'f-nor-cam', fromNode: 'norwich', toNode: 'cambridge', mode: 'feeder', travelMinutes: 82, frequencyPerHour: 1, ridershipOrFlow: 4600 },
    { id: 'f-not-lds', fromNode: 'nottingham', toNode: 'leeds', mode: 'feeder', travelMinutes: 96, frequencyPerHour: 1, ridershipOrFlow: 5100 },
  ],
};

// Maps UK corridors to real National Rail / TfL Unified API operator IDs
const CORRIDOR_OPERATOR_MAP: Record<string, string> = {
  'r-lon-mk': 'avanti-west-coast',
  'r-mk-bhm': 'avanti-west-coast',
  'r-bhm-man': 'avanti-west-coast',
  'r-man-pre': 'avanti-west-coast',
  'r-pre-car': 'avanti-west-coast',
  'r-car-gla': 'avanti-west-coast',
  'r-car-edi': 'avanti-west-coast',
  'r-lon-cam': 'greater-anglia',
  'r-cam-nor': 'greater-anglia',
  'f-nor-cam': 'greater-anglia',
  'r-lon-yrk': 'london-north-eastern-railway',
  'r-yrk-ncl': 'london-north-eastern-railway',
  'r-ncl-edi': 'london-north-eastern-railway',
  'r-edi-gla': 'scotrail',
  'r-edi-abd': 'scotrail',
  'r-edi-inv': 'scotrail',
  'r-abd-inv': 'scotrail',
  'r-lon-rdg': 'great-western-railway',
  'r-rdg-brs': 'great-western-railway',
  'r-brs-cdf': 'great-western-railway',
  'r-brs-exe': 'great-western-railway',
  'r-exe-ply': 'great-western-railway',
  'r-rdg-oxf': 'great-western-railway',
  'r-oxf-bhm': 'crosscountry',
  'r-lon-btn': 'thameslink',
  'r-bhm-shf': 'crosscountry',
  'r-shf-lds': 'crosscountry',
  'r-lds-yrk': 'transpennine-express',
  'r-man-lds': 'transpennine-express',
  'r-man-liv': 'northern-rail',
  'r-shf-not': 'east-midlands-railway',
  'r-not-lon': 'east-midlands-railway',
  'e-lon-lhr': 'elizabeth',
  'e-lhr-rdg': 'elizabeth',
  'f-rdg-lhr': 'elizabeth',
  'f-liv-pre': 'northern-rail',
  'f-yrk-shf': 'northern-rail',
  'f-exe-cdf': 'transport-for-wales',
  'e-cdf-bhm': 'transport-for-wales',
};

// ============================================================================
// 3. Guided Product Tour Steps (Executive & Public-Sector Walkthrough)
// ============================================================================

const TOUR_STEP_DURATION_MS = 5500;

const PRODUCT_TOUR_STEPS: TourStepDefinition[] = [
  {
    id: 'overview',
    category: '01. Network Intelligence',
    title: 'National Multimodal Corridor Flow',
    description:
      'Visualizes rail trunks, express coach links, and airport/port feeders in a unified 3D spatial graph. Corridor thickness and directional pulses scale directly with daily passenger demand.',
    audienceNote: 'Identifies national spine corridors and capacity concentrations at a glance.',
    camera: { center: [-2.35, 53.55], zoom: 5.55, pitch: 28, bearing: -4 },
  },
  {
    id: 'live',
    category: '02. Live GB Telemetry',
    title: 'Real-Time National Rail & Metro Feed',
    description:
      'Streams live status for Great Britain National Rail operators and Elizabeth line vehicle arrivals via a backend proxy, automatically applying delay multipliers to affected corridors.',
    audienceNote: 'Replaces static assumptions with live operational awareness across UK corridors.',
    camera: { center: [-1.45, 52.35], zoom: 6.1, pitch: 28, bearing: -3 },
  },
  {
    id: 'filtering',
    category: '03. Demand Thresholding',
    title: 'Mode Filtering & Capacity Isolation',
    description:
      'Filter transit modes independently and apply minimum ridership thresholds—shown here isolating high-volume Rail and Express links carrying 10,000+ passengers per day.',
    audienceNote: 'Separates strategic national trunk infrastructure from local feeder networks.',
    camera: { center: [-1.85, 52.85], zoom: 5.95, pitch: 26, bearing: -2 },
  },
  {
    id: 'hops',
    category: '04. Catchment & Connectivity',
    title: '1-Hop & 2-Hop Interchange Analysis',
    description:
      'Selecting Manchester Piccadilly isolates direct 1-hop corridors (sky rings) and single-transfer 2-hop reach (amber rings), quantifying regional hub catchment across the Midlands and North.',
    audienceNote: 'Supports accessibility equity audits and interchange investment planning.',
    camera: { center: [-2.05, 53.35], zoom: 6.65, pitch: 36, bearing: 10 },
  },
  {
    id: 'routing',
    category: '05. Journey Optimization',
    title: 'Travel-Time Gradient & Shortest Path',
    description:
      'Switches corridors to a Travel Time speed ramp while computing the minimum-time multimodal route from London to Edinburgh with leg-by-leg headways and cumulative arrival times.',
    audienceNote: 'Benchmarks door-to-door competitiveness across rail and express coach corridors.',
    camera: { center: [-1.75, 53.65], zoom: 5.8, pitch: 28, bearing: -6 },
  },
  {
    id: 'resilience',
    category: '06. Contingency Stress-Testing',
    title: 'Live Corridor Closure & Rerouting Impact',
    description:
      'Suspending the London–York trunk (31.2k pax/day) triggers instant Dijkstra rerouting, quantifying the exact +min delay penalty and displaced daily demand in real time.',
    audienceNote: 'Built for ministries of transport, national rail operators, and resilience teams.',
    camera: { center: [-1.6, 53.4], zoom: 5.85, pitch: 32, bearing: -2 },
  },
  {
    id: 'presentation',
    category: '07. Executive Cartography',
    title: 'Light Basemap & 2D Blueprint Mode',
    description:
      'Switch seamlessly between luminous dark operations mode and crisp high-contrast light cartography with flat 2D projection for policy briefs, printed reports, and public hearings.',
    audienceNote: 'Publication-ready visual output for ministerial and boardroom presentations.',
    camera: { center: [-2.2, 53.5], zoom: 5.55, pitch: 0, bearing: 0 },
  },
  {
    id: 'interop',
    category: '08. Open GIS Interoperability',
    title: 'Custom GeoJSON & Graph Ingestion',
    description:
      'Upload or paste any regional GeoJSON FeatureCollection or Graph JSON dataset, export live network geometry, and run the full analytical suite with zero vendor lock-in.',
    audienceNote: 'Ready for municipal, metro, and national infrastructure deployment.',
    camera: { center: [-2.35, 53.55], zoom: 5.55, pitch: 28, bearing: -4 },
  },
];

// ============================================================================
// 4. Visual Constants, Palettes & Formatting Helpers
// ============================================================================

const MODE_CONFIG: Record<
  TransitMode,
  {
    label: string;
    darkRgb: [number, number, number];
    lightRgb: [number, number, number];
    darkHex: string;
    lightHex: string;
    curveBias: number;
  }
> = {
  rail: {
    label: 'Rail',
    darkRgb: [56, 189, 248],
    lightRgb: [2, 132, 199],
    darkHex: '#38bdf8',
    lightHex: '#0284c7',
    curveBias: 0.04,
  },
  express: {
    label: 'Express',
    darkRgb: [245, 158, 11],
    lightRgb: [217, 119, 6],
    darkHex: '#f59e0b',
    lightHex: '#d97706',
    curveBias: 0.14,
  },
  feeder: {
    label: 'Feeder',
    darkRgb: [52, 211, 153],
    lightRgb: [5, 150, 105],
    darkHex: '#34d399',
    lightHex: '#059669',
    curveBias: -0.14,
  },
};

const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

function createFallbackStyle(isDark: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': isDark ? '#090d16' : '#f1f5f9',
        },
      },
    ],
  };
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}

function formatCompactFlow(flow: number): string {
  if (flow >= 1_000_000) return `${(flow / 1_000_000).toFixed(2)}M`;
  if (flow >= 1_000) return `${(flow / 1_000).toFixed(1)}k`;
  return String(flow);
}

function formatCoord(value: number, posLabel: string, negLabel: string): string {
  const abs = Math.abs(value).toFixed(2);
  return `${abs}°${value >= 0 ? posLabel : negLabel}`;
}

function interpolateTravelColor(minutes: number, minT: number, maxT: number, isDark: boolean): [number, number, number] {
  const span = Math.max(1, maxT - minT);
  const t = Math.max(0, Math.min(1, (minutes - minT) / span));
  if (t < 0.5) {
    const k = t * 2;
    const c1 = isDark ? [45, 212, 191] : [13, 148, 136];
    const c2 = isDark ? [250, 204, 21] : [217, 119, 6];
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * k),
      Math.round(c1[1] + (c2[1] - c1[1]) * k),
      Math.round(c1[2] + (c2[2] - c1[2]) * k),
    ];
  }
  const k = (t - 0.5) * 2;
  const c2 = isDark ? [250, 204, 21] : [217, 119, 6];
  const c3 = isDark ? [251, 113, 133] : [225, 29, 72];
  return [
    Math.round(c2[0] + (c3[0] - c2[0]) * k),
    Math.round(c2[1] + (c3[1] - c2[1]) * k),
    Math.round(c2[2] + (c3[2] - c2[2]) * k),
  ];
}

// ============================================================================
// 5. Curved Corridor Geometry & Particle Sampling
// ============================================================================

function buildCurvedPath(
  from: [number, number],
  to: [number, number],
  curvatureBias: number,
  segments = 24
): [number, number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.hypot(dx, dy) || 0.0001;
  const nx = -dy / dist;
  const ny = dx / dist;
  const offset = dist * curvatureBias;
  const ctrlLng = (from[0] + to[0]) / 2 + nx * offset;
  const ctrlLat = (from[1] + to[1]) / 2 + ny * offset;
  const archHeight = Math.min(28000, dist * 4200);

  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const inv = 1 - t;
    const lng = inv * inv * from[0] + 2 * inv * t * ctrlLng + t * t * to[0];
    const lat = inv * inv * from[1] + 2 * inv * t * ctrlLat + t * t * to[1];
    const elev = Math.sin(Math.PI * t) * archHeight;
    pts.push([lng, lat, elev]);
  }
  return pts;
}

function samplePathAt(path: [number, number, number][], t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (path.length - 1);
  const idx = Math.floor(scaled);
  const nextIdx = Math.min(path.length - 1, idx + 1);
  const frac = scaled - idx;
  const p0 = path[idx];
  const p1 = path[nextIdx];
  return [
    p0[0] + (p1[0] - p0[0]) * frac,
    p0[1] + (p1[1] - p0[1]) * frac,
    p0[2] + (p1[2] - p0[2]) * frac,
  ];
}

// ============================================================================
// 6. Graph Algorithms: Shortest Path (Dijkstra) & 1-Hop / 2-Hop Reach
// ============================================================================

function computeShortestPath(
  originId: string,
  destinationId: string,
  nodeMap: Map<string, NetworkNode>,
  edges: NetworkEdge[],
  directedOnly: boolean
): PathResult | null {
  const origin = nodeMap.get(originId);
  const destination = nodeMap.get(destinationId);
  if (!origin || !destination) return null;

  if (originId === destinationId) {
    return {
      origin,
      destination,
      reachable: true,
      totalMinutes: 0,
      transfers: 0,
      steps: [],
      nodeIds: [originId],
      edgeIds: [],
    };
  }

  const adj = new Map<string, Array<{ nextId: string; edge: NetworkEdge }>>();
  for (const edge of edges) {
    if (!nodeMap.has(edge.fromNode) || !nodeMap.has(edge.toNode)) continue;
    const forward = adj.get(edge.fromNode) ?? [];
    forward.push({ nextId: edge.toNode, edge });
    adj.set(edge.fromNode, forward);

    if (!directedOnly) {
      const reverse = adj.get(edge.toNode) ?? [];
      reverse.push({ nextId: edge.fromNode, edge });
      adj.set(edge.toNode, reverse);
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { prevNodeId: string; edge: NetworkEdge }>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; cost: number }> = [{ id: originId, cost: 0 }];
  dist.set(originId, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.id === destinationId) break;

    const neighbors = adj.get(current.id) ?? [];
    for (const { nextId, edge } of neighbors) {
      if (visited.has(nextId)) continue;
      const alt = current.cost + edge.travelMinutes;
      const existing = dist.get(nextId) ?? Infinity;
      if (alt < existing) {
        dist.set(nextId, alt);
        prev.set(nextId, { prevNodeId: current.id, edge });
        queue.push({ id: nextId, cost: alt });
      }
    }
  }

  if (!prev.has(destinationId)) {
    return {
      origin,
      destination,
      reachable: false,
      totalMinutes: 0,
      transfers: 0,
      steps: [],
      nodeIds: [],
      edgeIds: [],
    };
  }

  const rawSteps: Array<{ fromId: string; toId: string; edge: NetworkEdge }> = [];
  let cursor = destinationId;
  while (cursor !== originId) {
    const link = prev.get(cursor);
    if (!link) break;
    rawSteps.push({ fromId: link.prevNodeId, toId: cursor, edge: link.edge });
    cursor = link.prevNodeId;
  }
  rawSteps.reverse();

  let cumulative = 0;
  const steps: PathStep[] = [];
  const nodeIds: string[] = [originId];
  const edgeIds: string[] = [];

  for (const s of rawSteps) {
    const from = nodeMap.get(s.fromId);
    const to = nodeMap.get(s.toId);
    if (!from || !to) continue;
    cumulative += s.edge.travelMinutes;
    steps.push({
      edge: s.edge,
      from,
      to,
      cumulativeMinutes: cumulative,
    });
    nodeIds.push(s.toId);
    edgeIds.push(s.edge.id);
  }

  return {
    origin,
    destination,
    reachable: true,
    totalMinutes: cumulative,
    transfers: Math.max(0, steps.length - 1),
    steps,
    nodeIds,
    edgeIds,
  };
}

function computeHopAnalysis(
  centerNodeId: string,
  nodeMap: Map<string, NetworkNode>,
  edges: NetworkEdge[],
  directedOnly: boolean
): HopAnalysis | null {
  if (!nodeMap.has(centerNodeId)) return null;

  const hop1NodeIds = new Set<string>();
  const hop1EdgeIds = new Set<string>();
  const hop1Connections: HopAnalysis['hop1Connections'] = [];

  for (const edge of edges) {
    if (edge.fromNode === centerNodeId && nodeMap.has(edge.toNode)) {
      const target = nodeMap.get(edge.toNode)!;
      hop1NodeIds.add(edge.toNode);
      hop1EdgeIds.add(edge.id);
      hop1Connections.push({ node: target, edge, direction: 'outbound' });
    } else if (!directedOnly && edge.toNode === centerNodeId && nodeMap.has(edge.fromNode)) {
      const source = nodeMap.get(edge.fromNode)!;
      hop1NodeIds.add(edge.fromNode);
      hop1EdgeIds.add(edge.id);
      hop1Connections.push({ node: source, edge, direction: 'inbound' });
    }
  }

  const hop2NodeIds = new Set<string>();
  const hop2EdgeIds = new Set<string>();

  for (const edge of edges) {
    const fromIsHop1 = hop1NodeIds.has(edge.fromNode);
    const toIsHop1 = hop1NodeIds.has(edge.toNode);

    if (fromIsHop1 && edge.toNode !== centerNodeId && !hop1NodeIds.has(edge.toNode) && nodeMap.has(edge.toNode)) {
      hop2NodeIds.add(edge.toNode);
      hop2EdgeIds.add(edge.id);
    } else if (
      !directedOnly &&
      toIsHop1 &&
      edge.fromNode !== centerNodeId &&
      !hop1NodeIds.has(edge.fromNode) &&
      nodeMap.has(edge.fromNode)
    ) {
      hop2NodeIds.add(edge.fromNode);
      hop2EdgeIds.add(edge.id);
    }
  }

  const hop2Nodes = Array.from(hop2NodeIds)
    .map((id) => nodeMap.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  hop1Connections.sort((a, b) => a.edge.travelMinutes - b.edge.travelMinutes);

  return {
    centerNodeId,
    hop1NodeIds,
    hop2NodeIds,
    hop1EdgeIds,
    hop2EdgeIds,
    hop1Connections,
    hop2Nodes,
  };
}

// ============================================================================
// 7. Custom JSON / GeoJSON Parser & Exporter
// ============================================================================

function normalizeMode(raw: unknown): TransitMode {
  if (raw === 'rail' || raw === 'express' || raw === 'feeder') return raw;
  return 'rail';
}

function normalizeHubTier(raw: unknown): HubTier {
  if (raw === 'interchange' || raw === 'stop') return raw;
  return 'stop';
}

function parseCustomNetworkInput(rawText: string): { dataset?: NetworkDataset; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { error: 'Invalid JSON syntax. Please verify brackets, quotes, and commas.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'Input must be a JSON object or GeoJSON FeatureCollection.' };
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.nodes) && Array.isArray(obj.edges)) {
    const nodes: NetworkNode[] = [];
    const seenNodeIds = new Set<string>();

    for (let i = 0; i < obj.nodes.length; i++) {
      const n = obj.nodes[i] as Record<string, unknown>;
      if (!n || typeof n !== 'object') continue;
      const id = String(n.id ?? `node-${i}`).trim();
      const name = String(n.name ?? id).trim();
      const coords = Array.isArray(n.coordinates) ? n.coordinates : null;
      if (!coords || coords.length < 2 || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') {
        return { error: `Node "${id}" must have numeric coordinates [lng, lat].` };
      }
      if (!seenNodeIds.has(id)) {
        seenNodeIds.add(id);
        nodes.push({
          id,
          name,
          hubTier: normalizeHubTier(n.hubTier),
          coordinates: [coords[0], coords[1]],
        });
      }
    }

    if (nodes.length < 2) {
      return { error: 'At least 2 valid nodes are required to render a network.' };
    }

    const edges: NetworkEdge[] = [];
    for (let i = 0; i < obj.edges.length; i++) {
      const e = obj.edges[i] as Record<string, unknown>;
      if (!e || typeof e !== 'object') continue;
      const fromNode = String(e.fromNode ?? '').trim();
      const toNode = String(e.toNode ?? '').trim();
      if (!seenNodeIds.has(fromNode) || !seenNodeIds.has(toNode)) {
        return { error: `Edge #${i + 1} references unknown node "${fromNode}" or "${toNode}".` };
      }
      edges.push({
        id: String(e.id ?? `edge-${i}`),
        fromNode,
        toNode,
        mode: normalizeMode(e.mode),
        travelMinutes: Math.max(1, Number(e.travelMinutes) || 30),
        frequencyPerHour: Math.max(0.25, Number(e.frequencyPerHour) || 2),
        ridershipOrFlow: Math.max(100, Number(e.ridershipOrFlow) || 5000),
      });
    }

    if (edges.length === 0) {
      return { error: 'At least 1 valid edge is required.' };
    }

    return {
      dataset: {
        name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Custom Transit Network',
        nodes,
        edges,
      },
    };
  }

  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    const nodes: NetworkNode[] = [];
    const nodeMap = new Map<string, NetworkNode>();
    const lineFeatures: Array<{ id: string; props: Record<string, unknown>; coords: [number, number][] }> = [];

    for (let i = 0; i < obj.features.length; i++) {
      const feat = obj.features[i] as Record<string, unknown>;
      if (!feat || typeof feat !== 'object') continue;
      const geom = feat.geometry as Record<string, unknown> | undefined;
      const props = (feat.properties as Record<string, unknown>) ?? {};
      if (!geom || typeof geom.type !== 'string') continue;

      if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        const lng = Number(geom.coordinates[0]);
        const lat = Number(geom.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const id = String(props.id ?? feat.id ?? `pt-${i}`).trim();
        const node: NetworkNode = {
          id,
          name: String(props.name ?? props.title ?? id).trim(),
          hubTier: normalizeHubTier(props.hubTier),
          coordinates: [lng, lat],
        };
        if (!nodeMap.has(id)) {
          nodeMap.set(id, node);
          nodes.push(node);
        }
      } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        const coords: [number, number][] = [];
        for (const c of geom.coordinates) {
          if (Array.isArray(c) && c.length >= 2) {
            coords.push([Number(c[0]), Number(c[1])]);
          }
        }
        if (coords.length >= 2) {
          lineFeatures.push({
            id: String(props.id ?? feat.id ?? `line-${i}`),
            props,
            coords,
          });
        }
      }
    }

    const findNearestNode = (coord: [number, number]): NetworkNode | null => {
      let best: NetworkNode | null = null;
      let bestDist = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.coordinates[0] - coord[0], n.coordinates[1] - coord[1]);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
      return bestDist < 0.25 ? best : null;
    };

    const edges: NetworkEdge[] = [];
    for (let i = 0; i < lineFeatures.length; i++) {
      const lf = lineFeatures[i];
      let fromId = typeof lf.props.fromNode === 'string' ? lf.props.fromNode : '';
      let toId = typeof lf.props.toNode === 'string' ? lf.props.toNode : '';

      if (!fromId || !nodeMap.has(fromId)) {
        const matched = findNearestNode(lf.coords[0]);
        if (matched) {
          fromId = matched.id;
        } else {
          fromId = `auto-start-${i}`;
          const newNode: NetworkNode = {
            id: fromId,
            name: String(lf.props.fromName ?? `Station ${nodes.length + 1}`),
            hubTier: 'stop',
            coordinates: lf.coords[0],
          };
          nodeMap.set(fromId, newNode);
          nodes.push(newNode);
        }
      }

      if (!toId || !nodeMap.has(toId)) {
        const lastCoord = lf.coords[lf.coords.length - 1];
        const matched = findNearestNode(lastCoord);
        if (matched) {
          toId = matched.id;
        } else {
          toId = `auto-end-${i}`;
          const newNode: NetworkNode = {
            id: toId,
            name: String(lf.props.toName ?? `Station ${nodes.length + 1}`),
            hubTier: 'stop',
            coordinates: lastCoord,
          };
          nodeMap.set(toId, newNode);
          nodes.push(newNode);
        }
      }

      edges.push({
        id: lf.id,
        fromNode: fromId,
        toNode: toId,
        mode: normalizeMode(lf.props.mode),
        travelMinutes: Math.max(1, Number(lf.props.travelMinutes) || 35),
        frequencyPerHour: Math.max(0.25, Number(lf.props.frequencyPerHour) || 2),
        ridershipOrFlow: Math.max(100, Number(lf.props.ridershipOrFlow) || 6000),
      });
    }

    if (nodes.length < 2 || edges.length === 0) {
      return {
        error: 'GeoJSON FeatureCollection must contain at least 2 Point nodes and 1 LineString edge.',
      };
    }

    return {
      dataset: {
        name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'GeoJSON Transit Network',
        nodes,
        edges,
      },
    };
  }

  return {
    error: 'Unrecognized format. Provide either { "nodes": [...], "edges": [...] } or a GeoJSON FeatureCollection.',
  };
}

function datasetToGeoJson(dataset: NetworkDataset): string {
  const nodeMap = new Map(dataset.nodes.map((n) => [n.id, n]));
  const features = [
    ...dataset.nodes.map((node) => ({
      type: 'Feature',
      id: node.id,
      properties: {
        id: node.id,
        name: node.name,
        hubTier: node.hubTier,
      },
      geometry: {
        type: 'Point',
        coordinates: node.coordinates,
      },
    })),
    ...dataset.edges
      .filter((e) => nodeMap.has(e.fromNode) && nodeMap.has(e.toNode))
      .map((edge) => ({
        type: 'Feature',
        id: edge.id,
        properties: {
          id: edge.id,
          fromNode: edge.fromNode,
          toNode: edge.toNode,
          mode: edge.mode,
          travelMinutes: edge.travelMinutes,
          frequencyPerHour: edge.frequencyPerHour,
          ridershipOrFlow: edge.ridershipOrFlow,
        },
        geometry: {
          type: 'LineString',
          coordinates: [nodeMap.get(edge.fromNode)!.coordinates, nodeMap.get(edge.toNode)!.coordinates],
        },
      })),
  ];

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: dataset.name,
      features,
    },
    null,
    2
  );
}

const SAMPLE_IMPORT_GEOJSON = `{
  "type": "FeatureCollection",
  "name": "Randstad Express Loop",
  "features": [
    { "type": "Feature", "properties": { "id": "ams", "name": "Amsterdam Centraal", "hubTier": "interchange" }, "geometry": { "type": "Point", "coordinates": [4.9003, 52.3791] } },
    { "type": "Feature", "properties": { "id": "sch", "name": "Schiphol Airport", "hubTier": "stop" }, "geometry": { "type": "Point", "coordinates": [4.7619, 52.3094] } },
    { "type": "Feature", "properties": { "id": "dha", "name": "Den Haag Centraal", "hubTier": "interchange" }, "geometry": { "type": "Point", "coordinates": [4.3249, 52.081] } },
    { "type": "Feature", "properties": { "id": "rtm", "name": "Rotterdam Centraal", "hubTier": "interchange" }, "geometry": { "type": "Point", "coordinates": [4.4694, 51.9244] } },
    { "type": "Feature", "properties": { "id": "utr", "name": "Utrecht Centraal", "hubTier": "interchange" }, "geometry": { "type": "Point", "coordinates": [5.1101, 52.0894] } },
    { "type": "Feature", "properties": { "id": "lei", "name": "Leiden Centraal", "hubTier": "stop" }, "geometry": { "type": "Point", "coordinates": [4.4822, 52.1665] } },
    { "type": "Feature", "properties": { "id": "e1", "fromNode": "ams", "toNode": "sch", "mode": "rail", "travelMinutes": 16, "frequencyPerHour": 8, "ridershipOrFlow": 41000 }, "geometry": { "type": "LineString", "coordinates": [[4.9003, 52.3791], [4.7619, 52.3094]] } },
    { "type": "Feature", "properties": { "id": "e2", "fromNode": "sch", "toNode": "lei", "mode": "rail", "travelMinutes": 18, "frequencyPerHour": 6, "ridershipOrFlow": 24000 }, "geometry": { "type": "LineString", "coordinates": [[4.7619, 52.3094], [4.4822, 52.1665]] } },
    { "type": "Feature", "properties": { "id": "e3", "fromNode": "lei", "toNode": "dha", "mode": "rail", "travelMinutes": 12, "frequencyPerHour": 6, "ridershipOrFlow": 22500 }, "geometry": { "type": "LineString", "coordinates": [[4.4822, 52.1665], [4.3249, 52.081]] } },
    { "type": "Feature", "properties": { "id": "e4", "fromNode": "dha", "toNode": "rtm", "mode": "rail", "travelMinutes": 23, "frequencyPerHour": 6, "ridershipOrFlow": 29000 }, "geometry": { "type": "LineString", "coordinates": [[4.3249, 52.081], [4.4694, 51.9244]] } },
    { "type": "Feature", "properties": { "id": "e5", "fromNode": "rtm", "toNode": "utr", "mode": "rail", "travelMinutes": 37, "frequencyPerHour": 4, "ridershipOrFlow": 26500 }, "geometry": { "type": "LineString", "coordinates": [[4.4694, 51.9244], [5.1101, 52.0894]] } },
    { "type": "Feature", "properties": { "id": "e6", "fromNode": "utr", "toNode": "ams", "mode": "rail", "travelMinutes": 27, "frequencyPerHour": 8, "ridershipOrFlow": 39500 }, "geometry": { "type": "LineString", "coordinates": [[5.1101, 52.0894], [4.9003, 52.3791]] } },
    { "type": "Feature", "properties": { "id": "e7", "fromNode": "sch", "toNode": "rtm", "mode": "express", "travelMinutes": 26, "frequencyPerHour": 3, "ridershipOrFlow": 14800 }, "geometry": { "type": "LineString", "coordinates": [[4.7619, 52.3094], [4.4694, 51.9244]] } },
    { "type": "Feature", "properties": { "id": "e8", "fromNode": "lei", "toNode": "utr", "mode": "feeder", "travelMinutes": 41, "frequencyPerHour": 2, "ridershipOrFlow": 7800 }, "geometry": { "type": "LineString", "coordinates": [[4.4822, 52.1665], [5.1101, 52.0894]] } }
  ]
}`;

// ============================================================================
// 8. Main Single-File Application Component
// ============================================================================

export default function App() {
  const [dataset, setDataset] = useState<NetworkDataset>(INITIAL_UK_NETWORK);

  // Filters & Visual Controls
  const [enabledModes, setEnabledModes] = useState<Record<TransitMode, boolean>>({
    rail: true,
    express: true,
    feeder: true,
  });
  const [minFlow, setMinFlow] = useState<number>(0);
  const [edgeStyleMode, setEdgeStyleMode] = useState<EdgeStyleMode>('flow');
  const [isAnimating, setIsAnimating] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    return true;
  });
  const [directedRouting, setDirectedRouting] = useState<boolean>(false);

  // Resilience & Disruption Stress-Testing State
  const [disruptedEdgeIds, setDisruptedEdgeIds] = useState<string[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('routing');

  // Basemap & UI Layout
  const [isDark, setIsDark] = useState<boolean>(true);
  const [is3D, setIs3D] = useState<boolean>(true);
  const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState<boolean>(false);
  const [mobilePanel, setMobilePanel] = useState<'controls' | 'inspector' | 'map'>('controls');

  // Interactive Product Tour State
  const [tourStepIndex, setTourStepIndex] = useState<number | null>(null);
  const [tourAutoPlaying, setTourAutoPlaying] = useState<boolean>(false);
  const [tourProgress, setTourProgress] = useState<number>(0);

  // Live GB Transit Feed State (server-side proxy to TfL Unified & National Rail APIs)
  const [liveFeed, setLiveFeed] = useState<LiveTransitPayload | null>(null);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveEnabled, setLiveEnabled] = useState<boolean>(true);
  const [applyLiveDelays, setApplyLiveDelays] = useState<boolean>(true);
  const [selectedTelemetryLine, setSelectedTelemetryLine] = useState<string>('elizabeth');
  const [lineArrivals, setLineArrivals] = useState<LiveArrivalSample[] | null>(null);
  const [lineArrivalsLoading, setLineArrivalsLoading] = useState<boolean>(false);

  // Selection, Hops, & Routing State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('manchester');
  const [originId, setOriginId] = useState<string>('london');
  const [destinationId, setDestinationId] = useState<string>('edinburgh');
  const [hoveredLegEdgeId, setHoveredLegEdgeId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);

  // Custom JSON / GeoJSON Modal State
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copiedGeoJson, setCopiedGeoJson] = useState<boolean>(false);

  // Map & deck.gl Refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const animPhaseRef = useRef<number>(0);
  const isDarkRef = useRef<boolean>(isDark);
  const styleInitializedRef = useRef<boolean>(false);

  useEffect(() => {
    isDarkRef.current = isDark;
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Fetch live National Rail & TfL operator status + Elizabeth line predictions via Express proxy
  const fetchLiveData = useCallback(async (forceRefresh = false) => {
    setLiveLoading(true);
    try {
      const res = await fetch(`/api/transit/live${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LiveTransitPayload;
      setLiveFeed(data);
    } catch (err) {
      setLiveFeed((prev) => ({
        liveAvailable: false,
        source: 'TfL Unified & National Rail Live Status API',
        fetchedAt: new Date().toISOString(),
        cached: false,
        operators: prev?.operators ?? [],
        summary: prev?.summary ?? { totalLines: 0, goodServiceCount: 0, degradedCount: 0, activeIncidents: [] },
        elizabethTelemetry: prev?.elizabethTelemetry ?? {
          activePredictions: 0,
          trackedVehicles: 0,
          upcomingArrivals: [],
        },
        error: err instanceof Error ? err.message : 'Unable to fetch live feed',
      }));
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveData(false);
    const interval = window.setInterval(() => {
      fetchLiveData(false);
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [fetchLiveData]);

  // Fetch line-specific live arrivals when user switches live telemetry corridor
  useEffect(() => {
    if (selectedTelemetryLine === 'elizabeth') {
      setLineArrivals(liveFeed?.elizabethTelemetry.upcomingArrivals ?? null);
      return;
    }
    let cancelled = false;
    setLineArrivalsLoading(true);
    fetch(`/api/transit/arrivals/${encodeURIComponent(selectedTelemetryLine)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setLineArrivals(Array.isArray(data?.arrivals) ? data.arrivals : []);
        }
      })
      .catch(() => {
        if (!cancelled) setLineArrivals([]);
      })
      .finally(() => {
        if (!cancelled) setLineArrivalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTelemetryLine, liveFeed]);

  // Derived lookups & stats
  const nodeMap = useMemo(() => new Map(dataset.nodes.map((n) => [n.id, n])), [dataset.nodes]);
  const disruptedSet = useMemo(() => new Set(disruptedEdgeIds), [disruptedEdgeIds]);

  const operatorMap = useMemo(() => {
    const map = new Map<string, LiveOperatorStatus>();
    if (liveFeed?.operators) {
      for (const op of liveFeed.operators) {
        map.set(op.id, op);
      }
    }
    return map;
  }, [liveFeed]);

  // Map each UK edge to its real live operator status & delay multiplier
  const liveCorridorMap = useMemo(() => {
    const map = new Map<string, LiveCorridorTelemetry>();
    if (!liveEnabled || !liveFeed?.liveAvailable || dataset.name !== INITIAL_UK_NETWORK.name) {
      return map;
    }

    for (const edge of dataset.edges) {
      const opId = CORRIDOR_OPERATOR_MAP[edge.id];
      if (!opId) continue;
      const op = operatorMap.get(opId);
      if (!op) continue;

      let delayMultiplier = 1;
      if (applyLiveDelays) {
        if (op.severity === 9) {
          delayMultiplier = 1.15; // Minor Delays (+15%)
        } else if (op.severity >= 1 && op.severity <= 8) {
          delayMultiplier = 1.35; // Severe Delays / Part Closure (+35%)
        }
      }

      map.set(edge.id, {
        operatorId: op.id,
        operatorName: op.name,
        severity: op.severity,
        statusDescription: op.statusDescription,
        reason: op.reason,
        delayMultiplier,
      });
    }
    return map;
  }, [liveEnabled, liveFeed, dataset.name, dataset.edges, operatorMap, applyLiveDelays]);

  // Apply live delay multipliers to edges when Live Feed + Live Delays are active
  const effectiveEdges = useMemo(() => {
    if (liveCorridorMap.size === 0) return dataset.edges;
    return dataset.edges.map((edge) => {
      const live = liveCorridorMap.get(edge.id);
      if (!live || live.delayMultiplier === 1) return edge;
      return {
        ...edge,
        travelMinutes: Math.round(edge.travelMinutes * live.delayMultiplier),
      };
    });
  }, [dataset.edges, liveCorridorMap]);

  const flowStats = useMemo(() => {
    let min = Infinity;
    let max = 0;
    let minTime = Infinity;
    let maxTime = 0;
    const modeCounts: Record<TransitMode, number> = { rail: 0, express: 0, feeder: 0 };

    for (const e of effectiveEdges) {
      modeCounts[e.mode] += 1;
      if (e.ridershipOrFlow < min) min = e.ridershipOrFlow;
      if (e.ridershipOrFlow > max) max = e.ridershipOrFlow;
      if (e.travelMinutes < minTime) minTime = e.travelMinutes;
      if (e.travelMinutes > maxTime) maxTime = e.travelMinutes;
    }

    return {
      minFlow: min === Infinity ? 0 : min,
      maxFlow: Math.max(1000, Math.ceil(max / 1000) * 1000),
      minTime: minTime === Infinity ? 10 : minTime,
      maxTime: Math.max(30, maxTime),
      modeCounts,
    };
  }, [effectiveEdges]);

  // Filtered corridors (all visible under mode & minFlow)
  const filteredEdges = useMemo(() => {
    return effectiveEdges.filter(
      (edge) =>
        enabledModes[edge.mode] &&
        edge.ridershipOrFlow >= minFlow &&
        nodeMap.has(edge.fromNode) &&
        nodeMap.has(edge.toNode)
    );
  }, [effectiveEdges, enabledModes, minFlow, nodeMap]);

  // Operational corridors (excluding disrupted corridors)
  const operationalEdges = useMemo(
    () => filteredEdges.filter((e) => !disruptedSet.has(e.id)),
    [filteredEdges, disruptedSet]
  );

  // Executive KPIs computed directly from live network state
  const executiveMetrics = useMemo(() => {
    let activeFlow = 0;
    let totalMinutes = 0;
    let displacedFlow = 0;

    for (const e of filteredEdges) {
      if (disruptedSet.has(e.id)) {
        displacedFlow += e.ridershipOrFlow;
      } else {
        activeFlow += e.ridershipOrFlow;
        totalMinutes += e.travelMinutes;
      }
    }

    const avgTime = operationalEdges.length > 0 ? Math.round(totalMinutes / operationalEdges.length) : 0;
    const interchanges = dataset.nodes.filter((n) => n.hubTier === 'interchange').length;

    return {
      activeFlow,
      displacedFlow,
      avgTime,
      interchanges,
    };
  }, [filteredEdges, operationalEdges.length, disruptedSet, dataset.nodes]);

  // Top strategic corridors ranked by daily flow for stress testing
  const topCorridors = useMemo(() => {
    return [...filteredEdges]
      .sort((a, b) => b.ridershipOrFlow - a.ridershipOrFlow)
      .slice(0, 10);
  }, [filteredEdges]);

  // Precompute curved geometries
  const curvedEdges = useMemo<CurvedEdgeGeometry[]>(() => {
    const pairTracker = new Map<string, number>();
    return filteredEdges.map((edge) => {
      const from = nodeMap.get(edge.fromNode)!;
      const to = nodeMap.get(edge.toNode)!;
      const pairKey = [edge.fromNode, edge.toNode].sort().join('::');
      const count = pairTracker.get(pairKey) ?? 0;
      pairTracker.set(pairKey, count + 1);

      const directionSign = edge.fromNode < edge.toNode ? 1 : -1;
      const spreadBias = MODE_CONFIG[edge.mode].curveBias * directionSign + count * 0.045;
      return {
        edge,
        from,
        to,
        path: buildCurvedPath(from.coordinates, to.coordinates, spreadBias, 24),
      };
    });
  }, [filteredEdges, nodeMap]);

  // Hop analysis for selected node (uses operational corridors)
  const hopAnalysis = useMemo(() => {
    if (!selectedNodeId) return null;
    return computeHopAnalysis(selectedNodeId, nodeMap, operationalEdges, directedRouting);
  }, [selectedNodeId, nodeMap, operationalEdges, directedRouting]);

  // Baseline shortest path (all filtered edges open) vs Active shortest path (respecting disruptions)
  const baselinePathResult = useMemo(() => {
    if (!originId || !destinationId) return null;
    return computeShortestPath(originId, destinationId, nodeMap, filteredEdges, directedRouting);
  }, [originId, destinationId, nodeMap, filteredEdges, directedRouting]);

  const pathResult = useMemo(() => {
    if (!originId || !destinationId) return null;
    if (disruptedEdgeIds.length === 0) return baselinePathResult;
    return computeShortestPath(originId, destinationId, nodeMap, operationalEdges, directedRouting);
  }, [originId, destinationId, disruptedEdgeIds.length, baselinePathResult, nodeMap, operationalEdges, directedRouting]);

  const delayDeltaMinutes = useMemo(() => {
    if (disruptedEdgeIds.length === 0 || !baselinePathResult?.reachable || !pathResult?.reachable) return 0;
    return Math.max(0, pathResult.totalMinutes - baselinePathResult.totalMinutes);
  }, [disruptedEdgeIds.length, baselinePathResult, pathResult]);

  const pathEdgeSet = useMemo(() => new Set(pathResult?.edgeIds ?? []), [pathResult]);
  const pathNodeSet = useMemo(() => new Set(pathResult?.nodeIds ?? []), [pathResult]);

  // Node degree & total flow for tooltips
  const nodeMetrics = useMemo(() => {
    const metrics = new Map<string, { degree: number; totalFlow: number }>();
    for (const n of dataset.nodes) {
      metrics.set(n.id, { degree: 0, totalFlow: 0 });
    }
    for (const e of operationalEdges) {
      const f = metrics.get(e.fromNode);
      const t = metrics.get(e.toNode);
      if (f) {
        f.degree += 1;
        f.totalFlow += e.ridershipOrFlow;
      }
      if (t) {
        t.degree += 1;
        t.totalFlow += e.ridershipOrFlow;
      }
    }
    return metrics;
  }, [dataset.nodes, operationalEdges]);

  const fitNetworkBounds = useCallback((nodes: NetworkNode[]) => {
    const map = mapRef.current;
    if (!map || nodes.length === 0) return;
    if (nodes.length === 1) {
      map.flyTo({ center: nodes[0].coordinates, zoom: 8, duration: 700 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds(nodes[0].coordinates, nodes[0].coordinates);
    for (const n of nodes) {
      bounds.extend(n.coordinates);
    }
    map.fitBounds(bounds, {
      padding: { top: 90, bottom: 80, left: 390, right: 390 },
      maxZoom: 9.5,
      duration: 850,
    });
  }, []);

  // ==========================================================================
  // Product Tour Step Orchestration
  // ==========================================================================

  const applyTourStep = useCallback(
    (index: number) => {
      const step = PRODUCT_TOUR_STEPS[index];
      if (!step) return;

      const isDefaultUk = dataset.name === INITIAL_UK_NETWORK.name;

      if (step.id === 'overview') {
        setIsDark(true);
        setIs3D(true);
        setEnabledModes({ rail: true, express: true, feeder: true });
        setMinFlow(0);
        setEdgeStyleMode('flow');
        setIsAnimating(true);
        setDisruptedEdgeIds([]);
        setSelectedNodeId(null);
        setInspectorTab('routing');
      } else if (step.id === 'live') {
        setIsDark(true);
        setIs3D(true);
        setEnabledModes({ rail: true, express: true, feeder: true });
        setMinFlow(0);
        setEdgeStyleMode('flow');
        setDisruptedEdgeIds([]);
        setSelectedNodeId(null);
        setInspectorTab('live');
      } else if (step.id === 'filtering') {
        setIsDark(true);
        setIs3D(true);
        setEnabledModes({ rail: true, express: true, feeder: false });
        setMinFlow(10000);
        setEdgeStyleMode('flow');
        setDisruptedEdgeIds([]);
        setSelectedNodeId(null);
        setInspectorTab('routing');
      } else if (step.id === 'hops') {
        setIsDark(true);
        setIs3D(true);
        setEnabledModes({ rail: true, express: true, feeder: true });
        setMinFlow(0);
        setEdgeStyleMode('flow');
        setDisruptedEdgeIds([]);
        setSelectedNodeId(isDefaultUk ? 'manchester' : dataset.nodes[0]?.id ?? null);
        setInspectorTab('routing');
      } else if (step.id === 'routing') {
        setIsDark(true);
        setIs3D(true);
        setSelectedNodeId(null);
        setEdgeStyleMode('travelTime');
        setDisruptedEdgeIds([]);
        if (isDefaultUk) {
          setOriginId('london');
          setDestinationId('edinburgh');
        }
        setInspectorTab('routing');
      } else if (step.id === 'resilience') {
        setIsDark(true);
        setIs3D(true);
        setSelectedNodeId(null);
        setEdgeStyleMode('flow');
        if (isDefaultUk) {
          setOriginId('london');
          setDestinationId('edinburgh');
          setDisruptedEdgeIds(['r-lon-yrk']);
        } else if (dataset.edges[0]) {
          setDisruptedEdgeIds([dataset.edges[0].id]);
        }
        setInspectorTab('resilience');
      } else if (step.id === 'presentation') {
        setDisruptedEdgeIds([]);
        setSelectedNodeId(null);
        setEdgeStyleMode('flow');
        setIsDark(false);
        setIs3D(false);
        setInspectorTab('routing');
      } else if (step.id === 'interop') {
        setIsDark(true);
        setIs3D(true);
        setDisruptedEdgeIds([]);
        setEdgeStyleMode('flow');
        setInspectorTab('resilience');
      }

      if (mapRef.current) {
        if (isDefaultUk && step.camera) {
          mapRef.current.flyTo({
            center: step.camera.center,
            zoom: step.camera.zoom,
            pitch: step.camera.pitch,
            bearing: step.camera.bearing,
            duration: 950,
          });
        } else {
          fitNetworkBounds(dataset.nodes);
        }
      }
    },
    [dataset, fitNetworkBounds]
  );

  const startProductTour = () => {
    setControlsCollapsed(false);
    setInspectorCollapsed(false);
    setTourProgress(0);
    setTourStepIndex(0);
    setTourAutoPlaying(true);
    applyTourStep(0);
  };

  const goToTourStep = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= PRODUCT_TOUR_STEPS.length) {
        setTourStepIndex(null);
        setTourAutoPlaying(false);
        setTourProgress(0);
        return;
      }
      setTourProgress(0);
      setTourStepIndex(nextIndex);
      applyTourStep(nextIndex);
    },
    [applyTourStep]
  );

  const closeTour = () => {
    setTourAutoPlaying(false);
    setTourStepIndex(null);
    setTourProgress(0);
    setDisruptedEdgeIds([]);
    setIsDark(true);
    setIs3D(true);
  };

  // Auto-play progression loop for Product Tour
  useEffect(() => {
    if (tourStepIndex === null || !tourAutoPlaying) return;

    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const pct = Math.min(100, (elapsed / TOUR_STEP_DURATION_MS) * 100);
      setTourProgress(pct);

      if (elapsed >= TOUR_STEP_DURATION_MS) {
        window.clearInterval(timer);
        if (tourStepIndex < PRODUCT_TOUR_STEPS.length - 1) {
          const next = tourStepIndex + 1;
          setTourProgress(0);
          setTourStepIndex(next);
          applyTourStep(next);
        } else {
          setTourProgress(100);
          setTourAutoPlaying(false);
        }
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [tourStepIndex, tourAutoPlaying, applyTourStep]);

  // Build deck.gl layers
  const buildDeckLayers = useCallback(
    (animPhase: number) => {
      const hasFocusNode = Boolean(selectedNodeId && hopAnalysis);
      const hoveredEdgeId = hoverTarget?.kind === 'edge' ? hoverTarget.edge.id : hoveredLegEdgeId;
      const hoveredNodeId = hoverTarget?.kind === 'node' ? hoverTarget.node.id : null;

      const activeGeometries = curvedEdges.filter((g) => !disruptedSet.has(g.edge.id));
      const disruptedGeometries = curvedEdges.filter((g) => disruptedSet.has(g.edge.id));

      // 1a. Soft luminous ambient glow under major trunk corridors (dark mode depth)
      const trunkGlowGeometries = activeGeometries.filter((g) => g.edge.ridershipOrFlow >= 15000);
      const corridorGlowLayer = new PathLayer<CurvedEdgeGeometry>({
        id: 'network-corridors-glow',
        data: trunkGlowGeometries,
        pickable: false,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        getPath: (d) => d.path,
        getWidth: (d) => {
          const norm = d.edge.ridershipOrFlow / Math.max(1, flowStats.maxFlow);
          return 7 + norm * 10;
        },
        getColor: (d) => {
          const rgb =
            edgeStyleMode === 'flow'
              ? isDark
                ? MODE_CONFIG[d.edge.mode].darkRgb
                : MODE_CONFIG[d.edge.mode].lightRgb
              : interpolateTravelColor(d.edge.travelMinutes, flowStats.minTime, flowStats.maxTime, isDark);
          const alpha = hasFocusNode ? 14 : isDark ? 34 : 18;
          return [rgb[0], rgb[1], rgb[2], alpha];
        },
        updateTriggers: {
          getWidth: [flowStats.maxFlow],
          getColor: [isDark, edgeStyleMode, hasFocusNode, flowStats.minTime, flowStats.maxTime],
        },
      });

      // 1b. Active network corridors
      const corridorLayer = new PathLayer<CurvedEdgeGeometry>({
        id: 'network-corridors',
        data: activeGeometries,
        pickable: true,
        widthUnits: 'pixels',
        widthMinPixels: 1.8,
        widthMaxPixels: 11,
        capRounded: true,
        jointRounded: true,
        autoHighlight: true,
        highlightColor: isDark ? [255, 255, 255, 110] : [15, 23, 42, 90],
        getPath: (d) => d.path,
        getWidth: (d) => {
          const isPath = pathEdgeSet.has(d.edge.id);
          const isHov = hoveredEdgeId === d.edge.id;
          let base: number;
          if (edgeStyleMode === 'flow') {
            const norm = d.edge.ridershipOrFlow / Math.max(1, flowStats.maxFlow);
            base = 2 + Math.pow(norm, 0.72) * 6.5;
          } else {
            base = 1.8 + Math.min(6, d.edge.frequencyPerHour * 0.75);
          }
          if (isPath) return base + 2.4;
          if (isHov) return base + 2.2;
          return base;
        },
        getColor: (d) => {
          const id = d.edge.id;
          const isPath = pathEdgeSet.has(id);
          const isHov = hoveredEdgeId === id;

          let rgb: [number, number, number];
          if (edgeStyleMode === 'flow') {
            rgb = isDark ? MODE_CONFIG[d.edge.mode].darkRgb : MODE_CONFIG[d.edge.mode].lightRgb;
          } else {
            rgb = interpolateTravelColor(d.edge.travelMinutes, flowStats.minTime, flowStats.maxTime, isDark);
          }

          let alpha = 220;
          if (hasFocusNode && hopAnalysis) {
            if (hopAnalysis.hop1EdgeIds.has(id)) {
              alpha = 245;
            } else if (hopAnalysis.hop2EdgeIds.has(id)) {
              alpha = 185;
            } else if (isPath) {
              alpha = 230;
            } else {
              alpha = isDark ? 40 : 45;
            }
          } else if (edgeStyleMode === 'flow') {
            const flowNorm = d.edge.ridershipOrFlow / Math.max(1, flowStats.maxFlow);
            alpha = Math.round(135 + flowNorm * 115);
          }

          if (isHov) alpha = 255;
          return [rgb[0], rgb[1], rgb[2], alpha];
        },
        onHover: (info: PickingInfo<CurvedEdgeGeometry>) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setHoverTarget({
              kind: 'edge',
              edge: info.object.edge,
              from: info.object.from,
              to: info.object.to,
              x: info.x,
              y: info.y,
            });
          } else {
            setHoverTarget((prev) => (prev?.kind === 'edge' ? null : prev));
          }
        },
        updateTriggers: {
          getWidth: [edgeStyleMode, flowStats.maxFlow, pathEdgeSet, hoveredEdgeId],
          getColor: [
            isDark,
            edgeStyleMode,
            flowStats.maxFlow,
            flowStats.minTime,
            flowStats.maxTime,
            hasFocusNode,
            hopAnalysis,
            pathEdgeSet,
            hoveredEdgeId,
          ],
        },
      });

      // 1c. Disrupted / Closed Corridors Layer
      const disruptedLayer = new PathLayer<CurvedEdgeGeometry>({
        id: 'disrupted-corridors',
        data: disruptedGeometries,
        pickable: true,
        widthUnits: 'pixels',
        capRounded: true,
        getPath: (d) => d.path,
        getWidth: 4,
        getColor: isDark ? [239, 68, 68, 195] : [220, 38, 38, 200],
        onHover: (info: PickingInfo<CurvedEdgeGeometry>) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setHoverTarget({
              kind: 'edge',
              edge: info.object.edge,
              from: info.object.from,
              to: info.object.to,
              x: info.x,
              y: info.y,
            });
          } else {
            setHoverTarget((prev) => (prev?.kind === 'edge' ? null : prev));
          }
        },
      });

      // 2. Shortest-path highlight layers
      const pathGeometries = activeGeometries.filter((g) => pathEdgeSet.has(g.edge.id));
      const shortestPathGlowLayer = new PathLayer<CurvedEdgeGeometry>({
        id: 'shortest-path-glow',
        data: pathGeometries,
        pickable: false,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        getPath: (d) => d.path,
        getWidth: (d) => (hoveredLegEdgeId === d.edge.id ? 12 : 8.5),
        getColor: isDark ? [244, 63, 94, 115] : [225, 29, 72, 100],
        updateTriggers: {
          getWidth: [hoveredLegEdgeId],
          getColor: [isDark],
        },
      });

      const shortestPathCoreLayer = new PathLayer<CurvedEdgeGeometry>({
        id: 'shortest-path-core',
        data: pathGeometries,
        pickable: false,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        getPath: (d) => d.path,
        getWidth: (d) => (hoveredLegEdgeId === d.edge.id ? 4.8 : 3.4),
        getColor: isDark ? [255, 241, 242, 250] : [225, 29, 72, 245],
        updateTriggers: {
          getWidth: [hoveredLegEdgeId],
          getColor: [isDark],
        },
      });

      // 3. Animated directional flow particles
      const particles: FlowParticle[] = [];
      if (isAnimating) {
        for (let idx = 0; idx < activeGeometries.length; idx++) {
          const item = activeGeometries[idx];
          const isPath = pathEdgeSet.has(item.edge.id);
          const isHopRelevant =
            !hasFocusNode ||
            !hopAnalysis ||
            hopAnalysis.hop1EdgeIds.has(item.edge.id) ||
            hopAnalysis.hop2EdgeIds.has(item.edge.id) ||
            isPath;

          if (!isHopRelevant) continue;

          const pulseCount = item.edge.ridershipOrFlow > 20000 ? 4 : item.edge.ridershipOrFlow > 10000 ? 3 : 2;
          const speed = Math.max(0.18, Math.min(0.65, 26 / Math.max(15, item.edge.travelMinutes)));
          const baseRgb = isPath
            ? isDark
              ? [255, 228, 230]
              : [255, 255, 255]
            : edgeStyleMode === 'flow'
              ? isDark
                ? MODE_CONFIG[item.edge.mode].darkRgb
                : MODE_CONFIG[item.edge.mode].lightRgb
              : interpolateTravelColor(item.edge.travelMinutes, flowStats.minTime, flowStats.maxTime, isDark);

          for (let p = 0; p < pulseCount; p++) {
            const t = (animPhase * speed + p / pulseCount + (idx % 7) * 0.13) % 1;
            const position = samplePathAt(item.path, t);
            const edgeFade = Math.sin(Math.PI * t);
            const alpha = Math.round((isPath ? 255 : 225) * Math.max(0.25, edgeFade));
            particles.push({
              position,
              color: [baseRgb[0], baseRgb[1], baseRgb[2], alpha],
              radius: isPath ? 3.9 : 2.6 + Math.min(2, item.edge.ridershipOrFlow / 20000),
              edgeId: item.edge.id,
            });
          }
        }
      }

      const particleLayer = new ScatterplotLayer<FlowParticle>({
        id: 'flow-particles',
        data: particles,
        pickable: false,
        radiusUnits: 'pixels',
        getPosition: (d) => d.position,
        getRadius: (d) => d.radius,
        getFillColor: (d) => d.color,
      });

      // 4. Hop neighborhood outer rings
      const hopRingNodes = dataset.nodes.filter((n) => {
        if (n.id === selectedNodeId || n.id === originId || n.id === destinationId) return true;
        if (hopAnalysis && (hopAnalysis.hop1NodeIds.has(n.id) || hopAnalysis.hop2NodeIds.has(n.id))) return true;
        return false;
      });

      const hopRingLayer = new ScatterplotLayer<NetworkNode>({
        id: 'node-hop-rings',
        data: hopRingNodes,
        pickable: false,
        filled: false,
        stroked: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (d) => [d.coordinates[0], d.coordinates[1], 0],
        getRadius: (d) => {
          const base = d.hubTier === 'interchange' ? 11 : 8;
          if (d.id === selectedNodeId) return base + 6;
          if (d.id === originId || d.id === destinationId) return base + 5;
          return base + 4;
        },
        getLineWidth: (d) => {
          if (d.id === selectedNodeId || d.id === originId || d.id === destinationId) return 2.5;
          return 1.8;
        },
        getLineColor: (d) => {
          if (d.id === originId) return [16, 185, 129, 250];
          if (d.id === destinationId) return [244, 63, 94, 250];
          if (d.id === selectedNodeId) return isDark ? [255, 255, 255, 250] : [15, 23, 42, 240];
          if (hopAnalysis?.hop1NodeIds.has(d.id)) return isDark ? [56, 189, 248, 235] : [2, 132, 199, 235];
          if (hopAnalysis?.hop2NodeIds.has(d.id)) return isDark ? [251, 191, 36, 175] : [217, 119, 6, 175];
          return [148, 163, 184, 120];
        },
        updateTriggers: {
          getRadius: [selectedNodeId, originId, destinationId],
          getLineColor: [isDark, selectedNodeId, originId, destinationId, hopAnalysis],
        },
      });

      // 5. Station / Hub Nodes
      const nodeLayer = new ScatterplotLayer<NetworkNode>({
        id: 'network-nodes',
        data: dataset.nodes,
        pickable: true,
        filled: true,
        stroked: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (d) => [d.coordinates[0], d.coordinates[1], 0],
        getRadius: (d) => {
          const base = d.hubTier === 'interchange' ? 7 : 4.5;
          if (d.id === selectedNodeId || d.id === hoveredNodeId) return base + 2;
          if (pathNodeSet.has(d.id)) return base + 1;
          return base;
        },
        getLineWidth: (d) => (d.hubTier === 'interchange' ? 2 : 1.4),
        getFillColor: (d) => {
          if (d.id === originId) return [16, 185, 129, 255];
          if (d.id === destinationId) return [244, 63, 94, 255];
          if (d.id === selectedNodeId) return isDark ? [255, 255, 255, 255] : [15, 23, 42, 255];
          if (pathNodeSet.has(d.id)) return isDark ? [254, 205, 211, 255] : [225, 29, 72, 240];

          const isRelevant =
            !hasFocusNode ||
            !hopAnalysis ||
            hopAnalysis.hop1NodeIds.has(d.id) ||
            hopAnalysis.hop2NodeIds.has(d.id);

          const alpha = isRelevant ? 245 : 70;
          if (d.hubTier === 'interchange') {
            return isDark ? [226, 232, 240, alpha] : [30, 41, 59, alpha];
          }
          return isDark ? [148, 163, 184, alpha] : [100, 116, 139, alpha];
        },
        getLineColor: () => (isDark ? [15, 23, 42, 240] : [255, 255, 255, 240]),
        onHover: (info: PickingInfo<NetworkNode>) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setHoverTarget({
              kind: 'node',
              node: info.object,
              x: info.x,
              y: info.y,
            });
          } else {
            setHoverTarget((prev) => (prev?.kind === 'node' ? null : prev));
          }
        },
        onClick: (info: PickingInfo<NetworkNode>) => {
          if (info.object) {
            setSelectedNodeId(info.object.id);
          }
        },
        updateTriggers: {
          getRadius: [selectedNodeId, hoveredNodeId, pathNodeSet],
          getFillColor: [isDark, selectedNodeId, originId, destinationId, pathNodeSet, hasFocusNode, hopAnalysis],
          getLineColor: [isDark],
        },
      });

      // 6. Station Labels
      const labeledNodes = dataset.nodes.filter(
        (n) =>
          n.hubTier === 'interchange' ||
          n.id === selectedNodeId ||
          n.id === originId ||
          n.id === destinationId ||
          n.id === hoveredNodeId ||
          pathNodeSet.has(n.id) ||
          Boolean(hopAnalysis?.hop1NodeIds.has(n.id))
      );

      const labelLayer = new TextLayer<NetworkNode>({
        id: 'network-labels',
        data: labeledNodes,
        pickable: false,
        fontFamily: 'DM Sans, system-ui, sans-serif',
        fontWeight: 600,
        characterSet: 'auto',
        getPosition: (d) => [d.coordinates[0], d.coordinates[1], 0],
        getText: (d) => {
          if (d.id === originId) return `ORG · ${d.name.split(' ')[0]}`;
          if (d.id === destinationId) return `DST · ${d.name.split(' ')[0]}`;
          return d.name.split(' ')[0];
        },
        getSize: (d) => (d.hubTier === 'interchange' || d.id === selectedNodeId ? 12 : 10.5),
        getPixelOffset: [0, -14],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        getColor: (d) => {
          if (d.id === originId) return isDark ? [110, 231, 183, 255] : [4, 120, 87, 255];
          if (d.id === destinationId) return isDark ? [253, 164, 175, 255] : [190, 18, 60, 255];
          if (d.id === selectedNodeId) return isDark ? [255, 255, 255, 255] : [15, 23, 42, 255];
          return isDark ? [226, 232, 240, 220] : [30, 41, 59, 230];
        },
        outlineWidth: 3,
        outlineColor: isDark ? [9, 13, 22, 230] : [248, 250, 252, 235],
        updateTriggers: {
          getText: [originId, destinationId],
          getColor: [isDark, originId, destinationId, selectedNodeId],
          outlineColor: [isDark],
        },
      });

      return [
        corridorGlowLayer,
        corridorLayer,
        disruptedLayer,
        shortestPathGlowLayer,
        shortestPathCoreLayer,
        particleLayer,
        hopRingLayer,
        nodeLayer,
        labelLayer,
      ];
    },
    [
      curvedEdges,
      dataset.nodes,
      destinationId,
      disruptedSet,
      edgeStyleMode,
      flowStats.maxFlow,
      flowStats.maxTime,
      flowStats.minTime,
      hopAnalysis,
      hoverTarget,
      hoveredLegEdgeId,
      isAnimating,
      isDark,
      originId,
      pathEdgeSet,
      pathNodeSet,
      selectedNodeId,
    ]
  );

  const buildLayersRef = useRef(buildDeckLayers);
  buildLayersRef.current = buildDeckLayers;

  // Initialize MapLibre GL + Deck.gl MapboxOverlay
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: CARTO_DARK_STYLE,
      center: [-2.35, 53.55],
      zoom: 5.55,
      pitch: 26,
      bearing: -4,
      attributionControl: { compact: true },
    });

    let fallbackApplied = false;
    map.on('error', () => {
      if (!fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(createFallbackStyle(isDarkRef.current));
      }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-left');

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: buildLayersRef.current(animPhaseRef.current),
    });

    map.addControl(overlay as unknown as maplibregl.IControl);
    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      styleInitializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!styleInitializedRef.current) {
      styleInitializedRef.current = true;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(isDark ? CARTO_DARK_STYLE : CARTO_LIGHT_STYLE);
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      pitch: is3D ? 28 : 0,
      bearing: is3D ? -4 : 0,
      duration: 450,
    });
  }, [is3D]);

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({
        layers: buildDeckLayers(animPhaseRef.current),
      });
    }
  }, [buildDeckLayers]);

  useEffect(() => {
    if (!isAnimating) {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      animPhaseRef.current = (animPhaseRef.current + dt) % 1000;
      if (overlayRef.current) {
        overlayRef.current.setProps({
          layers: buildLayersRef.current(animPhaseRef.current),
        });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isAnimating]);

  // Handlers
  const toggleMode = (mode: TransitMode) => {
    setEnabledModes((prev) => ({ ...prev, [mode]: !prev[mode] }));
  };

  const toggleDisruptedEdge = (edgeId: string) => {
    setDisruptedEdgeIds((prev) =>
      prev.includes(edgeId) ? prev.filter((id) => id !== edgeId) : [...prev, edgeId]
    );
  };

  const handleResetFilters = () => {
    setEnabledModes({ rail: true, express: true, feeder: true });
    setMinFlow(0);
    setDirectedRouting(false);
    setDisruptedEdgeIds([]);
  };

  const handleSwapOriginDestination = () => {
    const prevOrig = originId;
    setOriginId(destinationId);
    setDestinationId(prevOrig);
  };

  const applyNewDataset = (next: NetworkDataset) => {
    setDataset(next);
    setEnabledModes({ rail: true, express: true, feeder: true });
    setMinFlow(0);
    setDisruptedEdgeIds([]);
    setTourStepIndex(null);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
    setOriginId(next.nodes[0]?.id ?? '');
    setDestinationId(next.nodes[Math.min(next.nodes.length - 1, 2)]?.id ?? next.nodes[0]?.id ?? '');
    setImportModalOpen(false);
    setImportError(null);
    setTimeout(() => fitNetworkBounds(next.nodes), 60);
  };

  const handleImportSubmit = () => {
    if (!importText.trim()) {
      setImportError('Paste JSON or GeoJSON data, or upload a file first.');
      return;
    }
    const result = parseCustomNetworkInput(importText);
    if (result.error || !result.dataset) {
      setImportError(result.error ?? 'Failed to parse dataset.');
      return;
    }
    applyNewDataset(result.dataset);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setImportText(content);
      setImportError(null);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleCopyGeoJson = async () => {
    const geojson = datasetToGeoJson(dataset);
    try {
      await navigator.clipboard.writeText(geojson);
      setCopiedGeoJson(true);
      setTimeout(() => setCopiedGeoJson(false), 1800);
    } catch {
      setImportText(geojson);
      setImportModalOpen(true);
    }
  };

  const handleDownloadGeoJson = () => {
    const geojson = datasetToGeoJson(dataset);
    const blob = new Blob([geojson], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const sortedNodes = useMemo(
    () => [...dataset.nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [dataset.nodes]
  );

  const activeTourStep = tourStepIndex !== null ? PRODUCT_TOUR_STEPS[tourStepIndex] : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100 select-none">
      {/* Full-Bleed MapLibre + deck.gl Canvas */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Interactive regional multimodal transit network map"
      />

      {/* Top-Center Executive Summary Bar (Desktop xl+) */}
      <div className="pointer-events-auto absolute left-1/2 top-4 z-10 hidden xl:flex -translate-x-1/2 items-center divide-x divide-slate-200/80 rounded-xl border border-slate-200/90 bg-white/92 px-2 py-2 shadow-lg backdrop-blur-md dark:divide-slate-800/80 dark:border-slate-800/90 dark:bg-slate-900/90">
        <div className="px-3.5 text-left">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Live GB Feed</div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
            {liveFeed?.liveAvailable
              ? `${liveFeed.summary.totalLines} lines · ${liveFeed.summary.degradedCount} alerts`
              : liveLoading
                ? 'Syncing...'
                : 'Offline baseline'}
          </div>
        </div>
        <div className="px-3.5 text-left">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Daily Network Flow</div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
            {formatCompactFlow(executiveMetrics.activeFlow)} pax/d
          </div>
        </div>
        <div className="px-3.5 text-left">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Corridor Status</div>
          <div
            className={`text-xs font-mono font-semibold whitespace-nowrap ${
              disruptedEdgeIds.length > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {disruptedEdgeIds.length > 0
              ? `${disruptedEdgeIds.length} closed · ${delayDeltaMinutes > 0 ? `+${delayDeltaMinutes}m` : 'rerouted'}`
              : 'Nominal'}
          </div>
        </div>
        <div className="pl-3 pr-1.5">
          <button
            type="button"
            onClick={startProductTour}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Compass className="h-3.5 w-3.5" />
            Product Tour
          </button>
        </div>
      </div>

      {/* Left Floating Control Panel */}
      <aside
        className={`absolute left-4 top-4 z-10 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200/90 bg-white/92 shadow-lg backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/90 ${
          mobilePanel === 'controls' ? 'block' : 'hidden md:block'
        }`}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-200/80 dark:border-slate-800/80 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {dataset.name}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                {dataset.nodes.length} hubs · {operationalEdges.length}/{dataset.edges.length} active
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIs3D((v) => !v)}
                title={is3D ? 'Switch to flat 2D view' : 'Switch to 3D tilted arcs'}
                className="rounded-lg px-2 py-1.5 text-xs font-mono font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
              >
                {is3D ? '3D' : '2D'}
              </button>
              <button
                type="button"
                onClick={() => setIsDark((v) => !v)}
                title={isDark ? 'Switch to light basemap' : 'Switch to dark basemap'}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
                aria-label="Toggle basemap theme"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => fitNetworkBounds(dataset.nodes)}
                title="Reset map viewport to network bounds"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
                aria-label="Fit map to network"
              >
                <Compass className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setControlsCollapsed((v) => !v)}
                title={controlsCollapsed ? 'Expand controls' : 'Collapse controls'}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
                aria-label="Toggle controls panel"
              >
                {controlsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Product Tour Button (visible on screens below xl where top bar is hidden) */}
          <div className="flex xl:hidden items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {formatCompactFlow(executiveMetrics.activeFlow)} pax/d
            </span>
            <button
              type="button"
              onClick={startProductTour}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Compass className="h-3.5 w-3.5" />
              Product Tour
            </button>
          </div>
        </div>

        {!controlsCollapsed && (
          <div className="p-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
            {/* Mode Filter Segmented Buttons */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  Transit Modes
                </span>
                {(minFlow > 0 ||
                  disruptedEdgeIds.length > 0 ||
                  !enabledModes.rail ||
                  !enabledModes.express ||
                  !enabledModes.feeder) && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="text-xs text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 font-medium"
                  >
                    Reset all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['rail', 'express', 'feeder'] as TransitMode[]).map((mode) => {
                  const active = enabledModes[mode];
                  const cfg = MODE_CONFIG[mode];
                  const colorHex = isDark ? cfg.darkHex : cfg.lightHex;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => toggleMode(mode)}
                      className={`flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-all ${
                        active
                          ? 'border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100'
                          : 'border-transparent bg-slate-100/60 text-slate-400 opacity-60 hover:opacity-85 dark:bg-slate-950/50 dark:text-slate-500'
                      }`}
                    >
                      <span className="mb-1.5 h-1 w-6 rounded-full" style={{ backgroundColor: colorHex }} />
                      <span className="text-xs font-medium whitespace-nowrap">{cfg.label}</span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {flowStats.modeCounts[mode]} links
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Edge Styling Switch */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                  Corridor Styling
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950/80">
                <button
                  type="button"
                  onClick={() => setEdgeStyleMode('flow')}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    edgeStyleMode === 'flow'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Flow Volume
                </button>
                <button
                  type="button"
                  onClick={() => setEdgeStyleMode('travelTime')}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    edgeStyleMode === 'travelTime'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Travel Time
                </button>
              </div>

              {edgeStyleMode === 'flow' ? (
                <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Width & glow</span>
                  <span className="font-mono">
                    {flowStats.minFlow.toLocaleString()}–{flowStats.maxFlow.toLocaleString()} pax/d
                  </span>
                </div>
              ) : (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-teal-400 via-amber-400 to-rose-400" />
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    <span>Fast ({flowStats.minTime}m)</span>
                    <span>Width: freq/hr</span>
                    <span>Long ({flowStats.maxTime}m)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Minimum Flow Threshold Slider */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="min-flow-slider" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Min Corridor Flow
                </label>
                <span className="text-xs font-mono text-slate-800 dark:text-slate-200">
                  {minFlow === 0 ? 'All flows' : `≥ ${minFlow.toLocaleString()} pax/d`}
                </span>
              </div>
              <input
                id="min-flow-slider"
                type="range"
                min={0}
                max={flowStats.maxFlow}
                step={1000}
                value={minFlow}
                onChange={(e) => setMinFlow(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />
            </div>

            {/* Animation & Routing Direction Controls */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAnimating((v) => !v)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  isAnimating
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                }`}
              >
                {isAnimating ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isAnimating ? 'Pause Flow' : 'Animate Flow'}
              </button>

              <button
                type="button"
                onClick={() => setDirectedRouting((v) => !v)}
                title="Toggle between bidirectional transit routing and strictly directed fromNode→toNode graph edges"
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  directedRouting
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200'
                }`}
              >
                {directedRouting ? 'Directed Graph' : 'Bidirectional'}
              </button>
            </div>

            {/* Import / Export Data Actions */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setImportModalOpen(true);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-colors whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Load JSON / GeoJSON
              </button>
              <button
                type="button"
                onClick={handleDownloadGeoJson}
                title="Download active network as GeoJSON"
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                aria-label="Export GeoJSON"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Right Floating Shortest-Path, Hops & Resilience Inspector */}
      <aside
        className={`absolute right-4 top-4 z-10 w-[364px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200/90 bg-white/92 shadow-lg backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/90 ${
          mobilePanel === 'inspector' ? 'block' : 'hidden md:block'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-950/80">
            <button
              type="button"
              onClick={() => setInspectorTab('routing')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                inspectorTab === 'routing'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Route className="h-3.5 w-3.5 text-rose-500" />
              Route
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('live')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                inspectorTab === 'live'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Radio className="h-3.5 w-3.5 text-emerald-500" />
              Live Feed
              {liveFeed?.liveAvailable && liveFeed.summary.degradedCount > 0 && (
                <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                  ({liveFeed.summary.degradedCount})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('resilience')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                inspectorTab === 'resilience'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              Resilience
              {disruptedEdgeIds.length > 0 && (
                <span className="font-mono text-[11px] text-rose-600 dark:text-rose-400">
                  ({disruptedEdgeIds.length})
                </span>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setInspectorCollapsed((v) => !v)}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
            aria-label="Toggle route and resilience inspector"
          >
            {inspectorCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {!inspectorCollapsed && inspectorTab === 'routing' && (
          <div className="p-4 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {/* Origin / Destination Selectors */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-8 text-[11px] font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      ORG
                    </span>
                    <select
                      aria-label="Origin station"
                      value={originId}
                      onChange={(e) => setOriginId(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {sortedNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 text-[11px] font-mono font-medium text-rose-600 dark:text-rose-400">
                      DST
                    </span>
                    <select
                      aria-label="Destination station"
                      value={destinationId}
                      onChange={(e) => setDestinationId(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {sortedNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSwapOriginDestination}
                  title="Swap origin and destination"
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Swap origin and destination"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Shortest-Path Summary & Leg Breakdown */}
              {pathResult && pathResult.reachable ? (
                <div className="pt-2">
                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-200/80 dark:border-slate-800/80 text-center">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Time</div>
                      <div className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                        {formatDuration(pathResult.totalMinutes)}
                        {delayDeltaMinutes > 0 && (
                          <span className="ml-1 text-[11px] text-rose-500">+{delayDeltaMinutes}m</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Transfers</div>
                      <div className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                        {pathResult.transfers}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Corridors</div>
                      <div className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                        {pathResult.steps.length}
                      </div>
                    </div>
                  </div>

                  {pathResult.steps.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Origin and destination are the same station.
                    </p>
                  ) : (
                    <div className="mt-2.5 max-h-[176px] overflow-y-auto space-y-1 pr-1">
                      {pathResult.steps.map((step, index) => {
                        const modeHex = isDark
                          ? MODE_CONFIG[step.edge.mode].darkHex
                          : MODE_CONFIG[step.edge.mode].lightHex;
                        const liveLeg = liveCorridorMap.get(step.edge.id);
                        return (
                          <div
                            key={`${step.edge.id}-${index}`}
                            onMouseEnter={() => setHoveredLegEdgeId(step.edge.id)}
                            onMouseLeave={() => setHoveredLegEdgeId(null)}
                            className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                                {step.from.name.split(' ')[0]} → {step.to.name.split(' ')[0]}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                                <span
                                  className="inline-block h-1.5 w-3 rounded-full shrink-0"
                                  style={{ backgroundColor: modeHex }}
                                />
                                <span>{MODE_CONFIG[step.edge.mode].label}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">{step.edge.frequencyPerHour}/hr</span>
                                {liveLeg && liveLeg.delayMultiplier > 1 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-600 dark:text-amber-400 truncate">
                                      {liveLeg.statusDescription}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => toggleDisruptedEdge(step.edge.id)}
                                title="Simulate closure on this corridor to test rerouting"
                                className="opacity-0 group-hover:opacity-100 rounded p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-500 transition-all"
                                aria-label={`Simulate closure on ${step.from.name} to ${step.to.name}`}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                              <div className="text-right font-mono">
                                <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                                  {step.edge.travelMinutes}m
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  @{formatDuration(step.cumulativeMinutes)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  <p className="font-medium">No reachable route under active filters or closures.</p>
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset filters & restore corridors
                  </button>
                </div>
              )}
            </div>

            {/* Selected Node 1-Hop & 2-Hop Neighborhood */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
              {selectedNode && hopAnalysis ? (
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                        <h3 className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {selectedNode.name}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {selectedNode.hubTier === 'interchange' ? 'Interchange Hub' : 'Regional Stop'} ·{' '}
                        {formatCoord(selectedNode.coordinates[1], 'N', 'S')},{' '}
                        {formatCoord(selectedNode.coordinates[0], 'E', 'W')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedNodeId(null)}
                      title="Clear node hop selection"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      aria-label="Clear selected node"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setOriginId(selectedNode.id)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:text-emerald-300 transition-colors"
                    >
                      Set as Origin
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestinationId(selectedNode.id)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-rose-400 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:border-rose-500 dark:hover:text-rose-300 transition-colors"
                    >
                      Set as Destination
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      <span>1-Hop Direct Connections</span>
                      <span className="font-mono text-sky-600 dark:text-sky-400">
                        {hopAnalysis.hop1NodeIds.size} hubs
                      </span>
                    </div>
                    {hopAnalysis.hop1Connections.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No direct corridors match current filters.</p>
                    ) : (
                      <div className="max-h-[115px] overflow-y-auto space-y-0.5 pr-1">
                        {hopAnalysis.hop1Connections.map(({ node, edge }) => (
                          <button
                            key={`${edge.id}-${node.id}`}
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            className="w-full flex items-center justify-between rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                          >
                            <span className="truncate text-slate-700 dark:text-slate-200">{node.name}</span>
                            <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400 ml-2">
                              {MODE_CONFIG[edge.mode].label} · {edge.travelMinutes}m
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      <span>2-Hop Reach (1 Transfer)</span>
                      <span className="font-mono text-amber-600 dark:text-amber-400">
                        {hopAnalysis.hop2Nodes.length} hubs
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {hopAnalysis.hop2Nodes.length > 0
                        ? hopAnalysis.hop2Nodes.map((n) => n.name.split(' ')[0]).join(' · ')
                        : 'None under active filters.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click any station node on the map to highlight its 1-hop and 2-hop network connections.
                </p>
              )}
            </div>
          </div>
        )}

        {!inspectorCollapsed && inspectorTab === 'resilience' && (
          <div className="p-4 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {/* Disruption Impact Summary */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-sky-500" />
                  Corridor Contingency Impact
                </span>
                {disruptedEdgeIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDisruptedEdgeIds([])}
                    className="text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                  >
                    Restore all
                  </button>
                )}
              </div>

              {disruptedEdgeIds.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Simulate single or multi-corridor closures below to measure rerouting penalties and displaced passenger demand across the active route.
                </p>
              ) : (
                <div className="rounded-lg border border-rose-200/80 bg-rose-50/70 p-3 dark:border-rose-900/60 dark:bg-rose-950/30 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {disruptedEdgeIds.length} corridor{disruptedEdgeIds.length > 1 ? 's' : ''} suspended
                    </span>
                    <span className="font-mono text-rose-700 dark:text-rose-300">
                      {formatCompactFlow(executiveMetrics.displacedFlow)} pax/d
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-rose-200/70 dark:border-rose-900/50 text-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Baseline</div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {baselinePathResult?.reachable ? formatDuration(baselinePathResult.totalMinutes) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Rerouted</div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        {pathResult?.reachable ? formatDuration(pathResult.totalMinutes) : 'Blocked'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Impact</div>
                      <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                        {!pathResult?.reachable
                          ? 'Isolated'
                          : delayDeltaMinutes > 0
                            ? `+${delayDeltaMinutes}m`
                            : '0m'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Strategic Trunk Corridors Ranked by Daily Flow */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  High-Demand Corridors (Stress Test)
                </span>
                <span className="text-[11px] font-mono text-slate-400">pax/day</span>
              </div>
              <div className="max-h-[270px] overflow-y-auto space-y-1 pr-1">
                {topCorridors.map((edge) => {
                  const from = nodeMap.get(edge.fromNode);
                  const to = nodeMap.get(edge.toNode);
                  if (!from || !to) return null;
                  const isClosed = disruptedSet.has(edge.id);
                  const modeHex = isDark ? MODE_CONFIG[edge.mode].darkHex : MODE_CONFIG[edge.mode].lightHex;
                  return (
                    <div
                      key={edge.id}
                      onMouseEnter={() => setHoveredLegEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredLegEdgeId(null)}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                        isClosed
                          ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className={`truncate font-medium ${isClosed ? 'line-through opacity-80' : ''}`}>
                          {from.name.split(' ')[0]} → {to.name.split(' ')[0]}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: modeHex }} />
                          <span>{MODE_CONFIG[edge.mode].label}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{formatCompactFlow(edge.ridershipOrFlow)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleDisruptedEdge(edge.id)}
                        className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          isClosed
                            ? 'bg-rose-600 text-white hover:bg-rose-500'
                            : 'border border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-500 dark:hover:text-rose-300'
                        }`}
                      >
                        {isClosed ? 'Restore' : 'Close'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!inspectorCollapsed && inspectorTab === 'live' && (
          <div className="p-4 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {/* Live Sync Header & Controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5 text-emerald-500" />
                    UK Live Transit Telemetry
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {liveFeed?.fetchedAt
                      ? `Synced ${new Date(liveFeed.fetchedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}${liveFeed.cached ? ' (cached)' : ''}`
                      : 'Connecting to TfL / National Rail...'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fetchLiveData(true)}
                  disabled={liveLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${liveLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {liveFeed && !liveFeed.liveAvailable && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300">
                  Live feed unreachable ({liveFeed.error ?? 'network error'}). Displaying baseline schedule.
                </div>
              )}

              {/* Live Routing Adjustments */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setLiveEnabled((v) => !v)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    liveEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                  }`}
                >
                  {liveEnabled ? 'Live Status: On' : 'Live Status: Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setApplyLiveDelays((v) => !v)}
                  disabled={!liveEnabled}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                    applyLiveDelays && liveEnabled
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                  }`}
                >
                  {applyLiveDelays ? 'Delay Routing: On' : 'Delay Routing: Off'}
                </button>
              </div>
            </div>

            {/* Live Operator Summary */}
            {liveFeed?.liveAvailable && (
              <>
                <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-200/80 dark:border-slate-800/80 text-center font-mono">
                  <div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Operators</div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      {liveFeed.summary.totalLines}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Good Service</div>
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {liveFeed.summary.goodServiceCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Advisories</div>
                    <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {liveFeed.summary.degradedCount}
                    </div>
                  </div>
                </div>

                {/* Active Live Advisories & Delays */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Active National Rail & Metro Alerts
                    </span>
                  </div>
                  {liveFeed.summary.activeIncidents.length === 0 ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      All monitored operators reporting Good Service.
                    </p>
                  ) : (
                    <div className="max-h-[155px] overflow-y-auto space-y-1.5 pr-1">
                      {liveFeed.summary.activeIncidents.map((op) => (
                        <div
                          key={op.id}
                          className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-2 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {op.name}
                            </span>
                            <span
                              className={`shrink-0 font-mono text-[10px] font-medium ${
                                op.severity >= 1 && op.severity <= 6
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {op.statusDescription}
                            </span>
                          </div>
                          {op.reason && (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 break-words">
                              {op.reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Live Active Vehicle Arrivals */}
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                      <TrainFront className="h-3.5 w-3.5 text-sky-500" />
                      Live Arrivals
                    </span>
                    <select
                      aria-label="Select live line telemetry"
                      value={selectedTelemetryLine}
                      onChange={(e) => setSelectedTelemetryLine(e.target.value)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      <option value="elizabeth">
                        Elizabeth line ({liveFeed.elizabethTelemetry.trackedVehicles} trains)
                      </option>
                      <option value="central">Central line</option>
                      <option value="northern">Northern line</option>
                      <option value="piccadilly">Piccadilly line</option>
                      <option value="jubilee">Jubilee line</option>
                      <option value="victoria">Victoria line</option>
                    </select>
                  </div>

                  {lineArrivalsLoading ? (
                    <p className="text-[11px] font-mono text-slate-400">Loading live train predictions...</p>
                  ) : (lineArrivals ?? liveFeed.elizabethTelemetry.upcomingArrivals).length === 0 ? (
                    <p className="text-[11px] text-slate-400">No imminent arrivals reported right now.</p>
                  ) : (
                    <div className="max-h-[155px] overflow-y-auto space-y-1 pr-1">
                      {(lineArrivals ?? liveFeed.elizabethTelemetry.upcomingArrivals).slice(0, 8).map((arr, idx) => (
                        <div
                          key={`${arr.vehicleId}-${arr.stationName}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800/70"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800 dark:text-slate-200">
                              {arr.stationName}
                            </div>
                            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                              To {arr.destinationName}
                            </div>
                          </div>
                          <span className="shrink-0 font-mono font-medium text-sky-600 dark:text-sky-400">
                            {arr.minutesAway === 0 ? 'Due' : `${arr.minutesAway}m`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </aside>

      {/* Interactive Auto-Playing Product Tour Card */}
      {activeTourStep && tourStepIndex !== null && (
        <div
          className="fixed bottom-14 md:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[460px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white/96 shadow-2xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/96"
          role="dialog"
          aria-label="Interactive Product Tour"
        >
          {/* Auto-play step progress bar */}
          <div className="h-1 w-full bg-slate-200/80 dark:bg-slate-800">
            <div
              className="h-full bg-sky-500 transition-[width] duration-75 ease-linear"
              style={{ width: `${tourProgress}%` }}
            />
          </div>

          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono font-medium text-sky-600 dark:text-sky-400">
                  {activeTourStep.category} · Step {tourStepIndex + 1} of {PRODUCT_TOUR_STEPS.length}
                </div>
                <h2 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
                  {activeTourStep.title}
                </h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (tourStepIndex === PRODUCT_TOUR_STEPS.length - 1 && !tourAutoPlaying && tourProgress >= 100) {
                      startProductTour();
                    } else {
                      setTourAutoPlaying((p) => !p);
                    }
                  }}
                  title={tourAutoPlaying ? 'Pause auto-play' : 'Resume auto-play'}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {tourAutoPlaying ? (
                    <>
                      <Pause className="h-3 w-3" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      Play
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label="Close product tour"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {activeTourStep.description}
            </p>

            <p className="mt-2 pt-2 border-t border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
              Strategic value: {activeTourStep.audienceNote}
            </p>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {PRODUCT_TOUR_STEPS.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goToTourStep(idx)}
                    aria-label={`Jump to tour step ${idx + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === tourStepIndex
                        ? 'w-5 bg-sky-500'
                        : idx < tourStepIndex
                          ? 'w-2.5 bg-sky-500/45 hover:bg-sky-500/70'
                          : 'w-2 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {activeTourStep.id === 'interop' && (
                  <button
                    type="button"
                    onClick={() => {
                      setTourAutoPlaying(false);
                      setImportModalOpen(true);
                    }}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    Open Importer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goToTourStep(tourStepIndex - 1)}
                  disabled={tourStepIndex === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                {tourStepIndex < PRODUCT_TOUR_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => goToTourStep(tourStepIndex + 1)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={startProductTour}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Replay
                    </button>
                    <button
                      type="button"
                      onClick={closeTour}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Finish
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Panel Switcher */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex md:hidden items-center gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={() => setMobilePanel((p) => (p === 'controls' ? 'map' : 'controls'))}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            mobilePanel === 'controls'
              ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Controls
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel((p) => (p === 'inspector' ? 'map' : 'inspector'))}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            mobilePanel === 'inspector'
              ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Route & Hops
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('map')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            mobilePanel === 'map'
              ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Map Only
        </button>
      </div>

      {/* Compact Legend Strip (Bottom-Right) */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 hidden sm:flex items-center gap-4 rounded-lg border border-slate-200/80 bg-white/88 px-3 py-1.5 text-[11px] text-slate-600 shadow-sm backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/88 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-400 bg-emerald-500" />
          Origin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-rose-400 bg-rose-500" />
          Destination
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-sky-400" />
          1-Hop
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-amber-400" />
          2-Hop
        </span>
        {disruptedEdgeIds.length > 0 && (
          <span className="flex items-center gap-1.5 text-rose-500">
            <span className="h-0.5 w-3 bg-rose-500" />
            Closed
          </span>
        )}
      </div>

      {/* Hover Tooltip */}
      {hoverTarget && (
        <div
          className="pointer-events-none fixed z-30 w-64 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95"
          style={{
            left: Math.min(
              typeof window !== 'undefined' ? window.innerWidth - 272 : hoverTarget.x + 14,
              hoverTarget.x + 14
            ),
            top: Math.min(
              typeof window !== 'undefined' ? window.innerHeight - 140 : hoverTarget.y + 14,
              hoverTarget.y + 14
            ),
          }}
        >
          {hoverTarget.kind === 'edge' ? (
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900 dark:text-white leading-snug">
                {hoverTarget.from.name.split(' ')[0]} → {hoverTarget.to.name.split(' ')[0]}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-3 rounded-full"
                  style={{
                    backgroundColor: disruptedSet.has(hoverTarget.edge.id)
                      ? '#ef4444'
                      : isDark
                        ? MODE_CONFIG[hoverTarget.edge.mode].darkHex
                        : MODE_CONFIG[hoverTarget.edge.mode].lightHex,
                  }}
                />
                <span>
                  {MODE_CONFIG[hoverTarget.edge.mode].label} Corridor
                  {disruptedSet.has(hoverTarget.edge.id) ? ' (Closed)' : ''}
                </span>
              </div>
              {liveCorridorMap.get(hoverTarget.edge.id) && (
                <div className="text-[11px] flex items-center justify-between gap-2 pt-1 text-slate-600 dark:text-slate-300">
                  <span className="truncate">{liveCorridorMap.get(hoverTarget.edge.id)!.operatorName}</span>
                  <span
                    className={`shrink-0 font-mono text-[10px] font-medium ${
                      liveCorridorMap.get(hoverTarget.edge.id)!.severity === 10
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {liveCorridorMap.get(hoverTarget.edge.id)!.statusDescription}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-200/80 dark:border-slate-800 font-mono">
                <div>
                  <div className="text-[10px] text-slate-400">Time</div>
                  <div className="text-slate-900 dark:text-slate-100 font-medium">
                    {hoverTarget.edge.travelMinutes}m
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Freq</div>
                  <div className="text-slate-900 dark:text-slate-100 font-medium">
                    {hoverTarget.edge.frequencyPerHour}/hr
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Flow</div>
                  <div className="text-slate-900 dark:text-slate-100 font-medium">
                    {(hoverTarget.edge.ridershipOrFlow / 1000).toFixed(1)}k
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">{hoverTarget.node.name}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {hoverTarget.node.hubTier === 'interchange' ? 'Interchange Hub' : 'Regional Stop'} ·{' '}
                <span className="font-mono">
                  {nodeMetrics.get(hoverTarget.node.id)?.degree ?? 0} corridors
                </span>
              </div>
              <div className="pt-1 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                Total flow: {(nodeMetrics.get(hoverTarget.node.id)?.totalFlow ?? 0).toLocaleString()} pax/d
              </div>
              <div className="text-[10px] text-sky-600 dark:text-sky-400 pt-0.5">
                Click node to inspect 1-hop & 2-hop reach
              </div>
            </div>
          )}
        </div>
      )}

      {/* Custom JSON / GeoJSON Import Modal */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div>
                <h2 id="import-modal-title" className="text-sm font-semibold text-slate-900 dark:text-white">
                  Load Custom Network (GeoJSON or Graph JSON)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Upload a file or paste a GeoJSON FeatureCollection / {'{ nodes, edges }'} object.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.geojson,application/json,application/geo+json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Choose .json / .geojson
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportText(SAMPLE_IMPORT_GEOJSON);
                    setImportError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Insert Sample GeoJSON
                </button>
                <button
                  type="button"
                  onClick={handleCopyGeoJson}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {copiedGeoJson ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedGeoJson ? 'Copied Active GeoJSON' : 'Copy Current GeoJSON'}
                </button>
                <button
                  type="button"
                  onClick={() => applyNewDataset(INITIAL_UK_NETWORK)}
                  className="ml-auto text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                >
                  Restore UK Default
                </button>
              </div>

              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportError(null);
                }}
                rows={12}
                placeholder='Paste GeoJSON FeatureCollection or { "nodes": [...], "edges": [...] }...'
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              {importError && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-300">
                  {importError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-lg px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
              >
                Apply Network Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
