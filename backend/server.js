'use strict';

/**
 * PSX Market Intelligence Engine — COMPLETE UNIFIED SERVER
 *
 * Combines:
 *  - V2 real-time engine (DPS API scraper, Playwright, WebSocket, Redis cache, Watchdog)
 *  - V1 pipelines (news scraper, currency scraper, AI insight generator, portfolio, rule engine)
 *
 * Entry point: node server.js (legacy) OR node src/index.js (v2 recommended)
 */

require('dotenv').config();

const express    = require('express');
const WebSocket  = require('ws');
const http       = require('http');
const cors       = require('cors');
const cron       = require('node-cron');

// ── V1 Modules ───────────────────────────────────────────────────────
const { scrapeMarketData }  = require('./scrapers/marketScraper');
const { scrapeNews }        = require('./scrapers/newsScraper');
const { scrapeCurrency }    = require('./scrapers/currencyScraper');
const { analyzeStock }      = require('./analysis/ruleEngine');
const { scoringEngine }     = require('./analysis/scoringEngine');
const { generateInsight }   = require('./analysis/insightGenerator');
const { dataStore }         = require('./store/dataStore');
const { getRepository }     = require('./sources/psxRepository');

// ── V2 Modules ───────────────────────────────────────────────────────
const { getState }          = require('./src/state/marketState');
const { getOrchestrator }   = require('./src/scraper/orchestrator');
const { getCache }          = require('./src/pipeline/cache');
const { getWatchdog }       = require('./src/monitoring/watchdog');
const { getMarketStatus }   = require('./src/utils/marketSession');
const v2Routes              = require('./src/api/routes');
const logger                = require('./src/utils/logger');

const app    = express();
const server = http.createServer(app);

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());

// ── WebSocket Server ─────────────────────────────────────────────────

const wss = new WebSocket.Server({ server });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: Date.now(), version: dataStore.getVersion() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Wire v2 state events into the same WebSocket server
const v2State = getState();

v2State.on('tick', ({ symbol, data, version }) => {
  const msg = JSON.stringify({ type: 'PSX_TICK', symbol, data, version, timestamp: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
});

v2State.on('batch', ({ symbols, updated, version }) => {
  const stocks = symbols.map(s => v2State.getStock(s)).filter(Boolean);
  const msg = JSON.stringify({ type: 'TICK_BATCH', payload: { stocks, updated }, version, timestamp: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
});

v2State.on('index', ({ name, data, version }) => {
  const msg = JSON.stringify({ type: 'INDEX_UPDATE', payload: { name, data }, version, timestamp: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
});

wss.on('connection', (ws) => {
  logger.info('WS client connected (unified server)');

  // Send v2 snapshot
  const snap = v2State.getSnapshot();
  ws.send(JSON.stringify({
    type: 'INIT',
    payload: {
      stocks: snap.stocks,
      indices: snap.indices,
      marketStatus: getMarketStatus(),
      version: snap.version,
    },
    timestamp: Date.now(),
  }));

  // Also send v1 full state
  ws.send(JSON.stringify({ type: 'MARKET_UPDATE', payload: dataStore.getAll(), timestamp: Date.now() }));

  ws.on('close', () => logger.info('WS client disconnected (unified server)'));
});

// ── V1 Pipeline Functions ─────────────────────────────────────────────

let psxRepository = null;

async function runMarketPipeline() {
  try {
    const stocks   = await scrapeMarketData();
    const currency = await scrapeCurrency();
    const news     = dataStore.getNews();

    const analyzed = stocks.map(stock => {
      const rule  = analyzeStock(stock);
      const score = scoringEngine(stock, news, currency);
      return { ...stock, ...rule, score };
    });

    dataStore.setStocks(analyzed);
    dataStore.setCurrency(currency);
    broadcast('MARKET_UPDATE', { stocks: analyzed, currency });
    logger.info({ count: analyzed.length }, 'V1 market pipeline broadcast');
  } catch (err) {
    logger.error({ err: err.message }, 'V1 market pipeline error');
  }
}

async function runNewsPipeline() {
  try {
    const news = await scrapeNews();
    dataStore.setNews(news);
    broadcast('NEWS_UPDATE', { news });
    logger.info({ count: news.length }, 'V1 news pipeline broadcast');
  } catch (err) {
    logger.error({ err: err.message }, 'V1 news pipeline error');
  }
}

async function runInsightPipeline() {
  try {
    const stocks   = dataStore.getStocks();
    const news     = dataStore.getNews();
    const currency = dataStore.getCurrency();
    if (!stocks.length) return;
    const insight = await generateInsight(stocks, news, currency);
    dataStore.setInsight(insight);
    broadcast('INSIGHT_UPDATE', { insight });
    logger.info('V1 insight pipeline broadcast');
  } catch (err) {
    logger.error({ err: err.message }, 'V1 insight pipeline error');
  }
}

// ── Cron Schedules (V1) ───────────────────────────────────────────────
cron.schedule('*/30 * * * * *', runMarketPipeline);   // every 30s
cron.schedule('*/3 * * * *',    runNewsPipeline);     // every 3 min
cron.schedule('*/2 * * * *',    runInsightPipeline);  // every 2 min

// ── REST API Routes ───────────────────────────────────────────────────

// V2 routes at /api/*
app.use('/api', v2Routes);

// V1 legacy routes (still fully functional)
app.get('/api/health', (req, res) => {
  const health = psxRepository ? psxRepository.getHealth() : { status: 'initializing' };
  res.json({
    status: 'ok',
    v2:     { stocks: v2State.stocks.size, version: v2State.version, marketStatus: getMarketStatus() },
    v1_psx: health,
    server_time: new Date().toISOString(),
  });
});

app.get('/api/market', (req, res) => {
  // Merge v2 real-time data with v1 analyzed data
  const v2Stocks  = v2State.getAllStocks();
  const v1Stocks  = dataStore.getStocks();
  const v2Map     = new Map(v2Stocks.map(s => [s.symbol, s]));

  // Enrich v1 stocks with v2 real-time prices where available
  const merged = v1Stocks.map(s => {
    const live = v2Map.get(s.symbol);
    if (live && live.price > 0) {
      return { ...s, price: live.price, change: live.change, changePercent: live.changePercent,
               volume: live.volume, high: live.high, low: live.low, source: 'live_v2' };
    }
    return s;
  });

  res.json({
    stocks: merged.length > 0 ? merged : v2Stocks,
    indices: v2State.getAllIndices(),
    currency: dataStore.getCurrency(),
    version: dataStore.getVersion(),
    timestamp: Date.now(),
    marketStatus: getMarketStatus(),
  });
});

app.get('/api/news',    (req, res) => res.json({ news:    dataStore.getNews(),    timestamp: Date.now() }));
app.get('/api/insight', (req, res) => res.json({ insight: dataStore.getInsight(), timestamp: Date.now() }));
app.get('/api/all',     (req, res) => res.json(dataStore.getAll()));

// V1 PSX Repository endpoints
app.get('/api/psx/market',        (req, res) => psxRepository ? res.json(psxRepository.getMarketState()) : res.status(503).json({ error: 'PSX data not ready' }));
app.get('/api/psx/stats',         (req, res) => psxRepository ? res.json(psxRepository.getMarketStats()) : res.status(503).json({ error: 'PSX data not ready' }));
app.get('/api/psx/indices',       (req, res) => psxRepository ? res.json({ indices: psxRepository.getAllIndices() }) : res.status(503).json({ error: 'PSX data not ready' }));
app.get('/api/psx/stock/:symbol', (req, res) => {
  if (!psxRepository) return res.status(503).json({ error: 'PSX data not ready' });
  const stock = psxRepository.getStock(req.params.symbol.toUpperCase());
  return stock ? res.json(stock) : res.status(404).json({ error: 'Not found' });
});

// Portfolio
app.get('/api/portfolio', (req, res) => res.json({ holdings: dataStore.getHoldings() }));

app.post('/api/portfolio', (req, res) => {
  const { symbol, qty, cost } = req.body || {};
  const sym = String(symbol || '').trim().toUpperCase();
  const quantity = parseFloat(qty);
  const avgCost  = parseFloat(cost);
  if (!sym || isNaN(quantity) || quantity <= 0 || isNaN(avgCost) || avgCost <= 0)
    return res.status(400).json({ error: 'Invalid portfolio data' });
  dataStore.upsertHolding({ symbol: sym, qty: quantity, cost: avgCost });
  broadcast('PORTFOLIO_UPDATE', { holdings: dataStore.getHoldings() });
  res.json({ holdings: dataStore.getHoldings() });
});

app.delete('/api/portfolio/:symbol', (req, res) => {
  const sym = String(req.params.symbol || '').trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: 'Symbol required' });
  dataStore.removeHolding(sym);
  broadcast('PORTFOLIO_UPDATE', { holdings: dataStore.getHoldings() });
  res.json({ holdings: dataStore.getHoldings() });
});

// Dev: inject test tick
app.post('/api/test/inject-tick', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Not allowed' });
  const { symbol, price } = req.body;
  if (!symbol || !price) return res.status(400).json({ error: 'symbol and price required' });
  v2State.applyTick({ symbol: String(symbol).toUpperCase(), price: Number(price), timestamp: Date.now(), sequenceId: Date.now(), source: 'injected' });
  res.json({ success: true, symbol });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Boot ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down...');
  try {
    await getOrchestrator().stop();
    getWatchdog().stop();
    await getCache().disconnect();
    if (psxRepository) psxRepository.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000);
  } catch (_) { process.exit(1); }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err) => logger.error({ err: err.message }, 'Uncaught exception'));
process.on('unhandledRejection', (r)   => logger.error({ r: String(r) }, 'Unhandled rejection'));

server.listen(PORT, async () => {
  logger.info({ port: PORT }, '🚀 PSX Complete Engine started (v1 + v2 unified)');

  // Start V2 real-time scraper engine
  try {
    await getOrchestrator().start();
    logger.info('V2 scraper orchestrator online');
  } catch (err) {
    logger.error({ err: err.message }, 'V2 scraper start failed');
  }

  // Start watchdog
  getWatchdog().start();

  // Start V1 PSX repository
  try {
    psxRepository = getRepository();
    await psxRepository.initialize();
    psxRepository.subscribe(event => {
      if (event.type === 'stock_update') {
        const msg = JSON.stringify({ type: 'PSX_TICK', symbol: event.data.symbol, data: event.data, version: event.version, timestamp: event.timestamp });
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
      }
    });
    logger.info('V1 PSX repository initialized');
  } catch (err) {
    logger.warn({ err: err.message }, 'V1 PSX repository init failed — continuing without it');
  }

  // Run V1 pipelines immediately
  await runNewsPipeline();
  await runMarketPipeline();
  runInsightPipeline(); // don't await — can be slow

  logger.info(`  REST API: http://localhost:${PORT}/api`);
  logger.info(`  WebSocket: ws://localhost:${PORT}`);
  logger.info(`  Health: http://localhost:${PORT}/api/health`);
});

module.exports = { app, server };
