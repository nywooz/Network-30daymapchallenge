import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const TFL_BASE_URL = 'https://api.tfl.gov.uk';
const USER_AGENT = 'BritainTransitNetwork/1.0';
const CACHE_TTL_MS = 30_000;

interface TflDisruption {
  category?: string;
  categoryDescription?: string;
  description?: string;
  additionalInfo?: string;
}

interface TflLineStatus {
  statusSeverity?: number;
  statusSeverityDescription?: string;
  reason?: string;
  disruption?: TflDisruption;
}

interface TflLineRecord {
  id: string;
  name: string;
  modeName: string;
  lineStatuses?: TflLineStatus[];
}

interface TflArrivalRecord {
  id?: string;
  vehicleId?: string;
  lineId?: string;
  lineName?: string;
  stationName?: string;
  destinationName?: string;
  towards?: string;
  currentLocation?: string;
  timeToStation?: number;
  expectedArrival?: string;
}

export interface LiveOperatorStatus {
  id: string;
  name: string;
  modeName: string;
  severity: number;
  statusDescription: string;
  reason: string | null;
}

export interface LiveArrivalSample {
  vehicleId: string;
  stationName: string;
  destinationName: string;
  towards: string;
  currentLocation: string;
  minutesAway: number;
  expectedArrival: string;
}

export interface LiveTransitPayload {
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

let cachedLivePayload: { data: LiveTransitPayload; expiresAt: number } | null = null;

function appendTflKey(url: string): string {
  const key = process.env.TFL_APP_KEY?.trim();
  if (!key) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}app_key=${encodeURIComponent(key)}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(appendTflKey(url), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Upstream HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getLiveTransitSnapshot(forceRefresh = false): Promise<LiveTransitPayload> {
  const now = Date.now();
  if (!forceRefresh && cachedLivePayload && now < cachedLivePayload.expiresAt) {
    return {
      ...cachedLivePayload.data,
      cached: true,
    };
  }

  try {
    const [linesRaw, elizabethArrivalsRaw] = await Promise.all([
      fetchJsonWithTimeout<TflLineRecord[]>(
        `${TFL_BASE_URL}/Line/Mode/national-rail,elizabeth-line,overground,tube,dlr/Status?detail=true`
      ),
      fetchJsonWithTimeout<TflArrivalRecord[]>(`${TFL_BASE_URL}/Line/elizabeth/Arrivals`).catch(
        () => [] as TflArrivalRecord[]
      ),
    ]);

    const operators: LiveOperatorStatus[] = (Array.isArray(linesRaw) ? linesRaw : []).map((line) => {
      const primaryStatus = line.lineStatuses?.[0];
      const severity = typeof primaryStatus?.statusSeverity === 'number' ? primaryStatus.statusSeverity : 10;
      const statusDescription = primaryStatus?.statusSeverityDescription ?? 'Good Service';
      const reason =
        primaryStatus?.reason?.trim() ||
        primaryStatus?.disruption?.description?.trim() ||
        null;

      return {
        id: line.id,
        name: line.name,
        modeName: line.modeName,
        severity,
        statusDescription,
        reason,
      };
    });

    const goodServiceCount = operators.filter((op) => op.severity === 10).length;
    const activeIncidents = operators
      .filter((op) => op.severity !== 10)
      .sort((a, b) => a.severity - b.severity);

    const arrivalsList = Array.isArray(elizabethArrivalsRaw) ? elizabethArrivalsRaw : [];
    const trackedVehicleSet = new Set<string>();
    for (const a of arrivalsList) {
      if (a.vehicleId) trackedVehicleSet.add(a.vehicleId);
    }

    const upcomingArrivals: LiveArrivalSample[] = arrivalsList
      .filter((a) => typeof a.timeToStation === 'number' && a.stationName && a.destinationName)
      .sort((a, b) => (a.timeToStation ?? 9999) - (b.timeToStation ?? 9999))
      .slice(0, 12)
      .map((a) => ({
        vehicleId: a.vehicleId ?? 'train',
        stationName: (a.stationName ?? '').replace(/ Rail Station$/i, ''),
        destinationName: (a.destinationName ?? '').replace(/ Rail Station$/i, ''),
        towards: a.towards ?? '',
        currentLocation: a.currentLocation ?? '',
        minutesAway: Math.max(0, Math.round((a.timeToStation ?? 0) / 60)),
        expectedArrival: a.expectedArrival ?? '',
      }));

    const payload: LiveTransitPayload = {
      liveAvailable: true,
      source: 'TfL Unified & National Rail Live Status API',
      fetchedAt: new Date().toISOString(),
      cached: false,
      operators,
      summary: {
        totalLines: operators.length,
        goodServiceCount,
        degradedCount: activeIncidents.length,
        activeIncidents,
      },
      elizabethTelemetry: {
        activePredictions: arrivalsList.length,
        trackedVehicles: trackedVehicleSet.size,
        upcomingArrivals,
      },
    };

    cachedLivePayload = {
      data: payload,
      expiresAt: now + CACHE_TTL_MS,
    };

    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach live transit feed';
    return {
      liveAvailable: false,
      source: 'TfL Unified & National Rail Live Status API',
      fetchedAt: new Date().toISOString(),
      cached: false,
      operators: [],
      summary: {
        totalLines: 0,
        goodServiceCount: 0,
        degradedCount: 0,
        activeIncidents: [],
      },
      elizabethTelemetry: {
        activePredictions: 0,
        trackedVehicles: 0,
        upcomingArrivals: [],
      },
      error: message,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/transit/live', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const snapshot = await getLiveTransitSnapshot(forceRefresh);
    res.json(snapshot);
  });

  app.get('/api/transit/arrivals/:lineId', async (req, res) => {
    const lineId = req.params.lineId;
    if (!/^[a-z0-9-]+$/i.test(lineId)) {
      res.status(400).json({ error: 'Invalid lineId parameter' });
      return;
    }

    try {
      const arrivalsRaw = await fetchJsonWithTimeout<TflArrivalRecord[]>(
        `${TFL_BASE_URL}/Line/${encodeURIComponent(lineId)}/Arrivals`
      );
      const arrivals = (Array.isArray(arrivalsRaw) ? arrivalsRaw : [])
        .filter((a) => typeof a.timeToStation === 'number')
        .sort((a, b) => (a.timeToStation ?? 9999) - (b.timeToStation ?? 9999))
        .slice(0, 20)
        .map((a) => ({
          vehicleId: a.vehicleId ?? 'unit',
          stationName: (a.stationName ?? '').replace(/ Rail Station$/i, ''),
          destinationName: (a.destinationName ?? '').replace(/ Rail Station$/i, ''),
          towards: a.towards ?? '',
          currentLocation: a.currentLocation ?? '',
          minutesAway: Math.max(0, Math.round((a.timeToStation ?? 0) / 60)),
          expectedArrival: a.expectedArrival ?? '',
        }));

      res.json({
        lineId,
        fetchedAt: new Date().toISOString(),
        totalPredictions: Array.isArray(arrivalsRaw) ? arrivalsRaw.length : 0,
        arrivals,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch live arrivals',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Transit network server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
