# PSX Market Intelligence Engine — COMPLETE (v1 + v2)

This ZIP contains **every file** from both your original engine and the new v2 upgrade — fully merged into one unified project.

---

## What's Inside

```
psx-complete/
│
├── backend/
│   │
│   ├── server.js                    ← UNIFIED SERVER (runs v1 + v2 together)
│   ├── package.json                 ← All deps merged (v1 + v2)
│   ├── .env.example
│   ├── Dockerfile
│   │
│   ├── src/                         ─── V2 NEW ENGINE ───────────────────────
│   │   ├── index.js                 ← V2 standalone entry (clean, no v1 deps)
│   │   ├── api/routes.js            ← REST API (market, stocks, candles, etc.)
│   │   ├── websocket/
│   │   │   └── broadcastServer.js   ← WS server (delta updates, subscriptions)
│   │   ├── scraper/
│   │   │   ├── dpsScraper.js        ← PRIMARY: dps.psx.com.pk API, 2s adaptive
│   │   │   ├── playwrightScraper.js ← SECONDARY: Chromium + MutationObserver
│   │   │   └── orchestrator.js      ← Failover coordinator
│   │   ├── state/
│   │   │   ├── marketState.js       ← Global state + candle engine + tick history
│   │   │   └── tickValidator.js     ← Strict schema validation
│   │   ├── pipeline/
│   │   │   └── cache.js             ← Redis layer (optional, graceful degradation)
│   │   ├── monitoring/
│   │   │   └── watchdog.js          ← Stale data detection, auto-restart
│   │   └── utils/
│   │       ├── logger.js            ← Pino structured logger
│   │       ├── numbers.js           ← Parsing utilities
│   │       └── marketSession.js     ← PKT hours, adaptive poll intervals
│   │
│   ├── scrapers/                    ─── V1 ORIGINAL ─────────────────────────
│   │   ├── marketScraper.js         ← DPS HTML scraper (original)
│   │   ├── newsScraper.js           ← RSS news scraper (Dawn, BRec, ARY, etc.)
│   │   ├── currencyScraper.js       ← USD/PKR live rate
│   │   └── psxHighFrequencyScraper.js ← Original Puppeteer HF scraper
│   │
│   ├── store/                       ─── V1 ORIGINAL ─────────────────────────
│   │   ├── dataStore.js             ← In-memory store with file persistence
│   │   ├── dataNormalizer.js        ← V1 normalizer/validator
│   │   └── portfolio.json           ← Persisted portfolio holdings
│   │
│   ├── analysis/                    ─── V1 ORIGINAL ─────────────────────────
│   │   ├── ruleEngine.js            ← Momentum/volume signal classifier
│   │   ├── scoringEngine.js         ← Weighted score (momentum+volume+news+FX)
│   │   └── insightGenerator.js      ← Claude AI market briefing generator
│   │
│   └── sources/                     ─── V1 ORIGINAL ─────────────────────────
│       ├── psxDataSource.js         ← WS/polling data source abstraction
│       ├── marketState.js           ← V1 market state manager
│       ├── psxRepository.js         ← PSX data repository orchestrator
│       └── PSX_INTEGRATION_GUIDE.js ← Live feed integration instructions
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  ← V2 terminal UI (ticker, table, heatmap, charts)
│   │   ├── App.css                  ← V2 dark terminal theme
│   │   ├── index.css                ← V1 original CSS (preserved)
│   │   ├── main.jsx
│   │   └── hooks/
│   │       ├── useMarketData.js     ← V2 WS hook (reconnect, latest-tick-wins)
│   │       └── useCandleData.js     ← V2 candle data fetcher
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
│
├── docs/
│   ├── ARCHITECTURE.md              ← V1 original architecture doc
│   ├── PSX_REALTIME_SYSTEM.md       ← V1 realtime system doc
│   └── IMPLEMENTATION_COMPLETE.md   ← V1 implementation notes
│
├── docker-compose.yml
├── ecosystem.config.js              ← PM2
├── vercel.json
├── scripts/setup.sh
└── README.md
```

---

## Quick Start

### Option A — Unified Server (v1 + v2 together, recommended)

```bash
cd backend
npm install
npx playwright install chromium --with-deps
cp .env.example .env
node server.js
```

### Option B — V2 Engine Only (leaner, no AI insight/news)

```bash
cd backend
npm install
npx playwright install chromium --with-deps
node src/index.js
```

### Option C — Docker (full stack)

```bash
docker compose up -d
```

### Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## What Each Mode Provides

| Feature | V2 (`src/index.js`) | Unified (`server.js`) |
|---|---|---|
| Real-time stock prices (DPS API) | ✅ | ✅ |
| Playwright browser scraper | ✅ | ✅ |
| WebSocket push (TICK/TICK_BATCH) | ✅ | ✅ |
| KSE-100 / KSE-30 indices | ✅ | ✅ |
| Candle charts (OHLCV) | ✅ | ✅ |
| Redis cache | ✅ | ✅ |
| Watchdog / auto-restart | ✅ | ✅ |
| News scraper (RSS) | ❌ | ✅ |
| USD/PKR currency feed | ❌ | ✅ |
| AI market insight (Claude) | ❌ | ✅ |
| Rule engine (signal/risk) | ❌ | ✅ |
| Portfolio management | ❌ | ✅ |
| V1 PSX Repository | ❌ | ✅ |

---

## Environment Variables

Copy and edit `backend/.env.example` → `backend/.env`

Key variables:

```env
PORT=3001
REDIS_URL=redis://localhost:6379
ENABLE_PLAYWRIGHT=true
ANTHROPIC_API_KEY=sk-ant-...   # Required for AI insight feature
LOG_LEVEL=info
```

---

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/health` | Full system health (v1 + v2) |
| `GET /api/market` | All stocks (v1+v2 merged), indices, currency |
| `GET /api/stocks` | Paginated stocks with filter/sort |
| `GET /api/stocks/:symbol` | Single stock |
| `GET /api/indices` | KSE-100, KSE-30 |
| `GET /api/gainers` | Top gainers |
| `GET /api/losers` | Top losers |
| `GET /api/active` | Most active |
| `GET /api/candles/:symbol` | OHLCV candlestick data |
| `GET /api/ticks/:symbol` | Raw tick history |
| `GET /api/news` | Latest news articles |
| `GET /api/insight` | AI market briefing |
| `GET /api/portfolio` | Portfolio holdings |
| `POST /api/portfolio` | Add/update holding |
| `DELETE /api/portfolio/:symbol` | Remove holding |
| `GET /api/psx/market` | V1 PSX repository state |
| `GET /api/stats` | Engine statistics |

---

## WebSocket Events

```
ws://localhost:3001

Server → Client:
  INIT          Full snapshot on connect
  TICK          Single stock update
  TICK_BATCH    Batch of changed stocks
  INDEX_UPDATE  KSE-100 or KSE-30 update
  PSX_TICK      V1 PSX repository tick
  MARKET_UPDATE V1 full market update
  NEWS_UPDATE   New articles fetched
  INSIGHT_UPDATE New AI briefing ready
  HEARTBEAT     Keep-alive every 15s
```
