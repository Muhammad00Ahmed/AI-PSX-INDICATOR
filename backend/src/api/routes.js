'use strict';

const express  = require('express');
const logger   = require('../utils/logger');
const { getState }        = require('../state/marketState');
const { getOrchestrator } = require('../scraper/orchestrator');
const { getCache }        = require('../pipeline/cache');
const { getMarketStatus, isMarketOpen } = require('../utils/marketSession');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────

function getOrchestratorSafe() {
  try { return getOrchestrator(); } catch (_) { return null; }
}

// ── Health & Status ────────────────────────────────────────────────────

router.get('/health', async (req, res) => {
  const state  = getState();
  const orch   = getOrchestratorSafe();
  const cache  = await getCache().healthCheck();
  const stats  = state.getStats();

  const healthy = stats.totalStocks > 0;
  res.status(healthy ? 200 : 503).json({
    status:         healthy ? 'ok' : 'degraded',
    marketStatus:   getMarketStatus(),
    isMarketOpen:   isMarketOpen(),
    stocks:         stats.totalStocks,
    indices:        stats.totalIndices,
    version:        state.version,
    lastUpdate:     state.lastUpdateTime,
    scraper:        orch ? orch.getHealth() : null,
    cache,
    uptime:         process.uptime(),
    memory:         process.memoryUsage(),
    serverTime:     new Date().toISOString(),
  });
});

router.get('/status', (req, res) => {
  const state = getState();
  res.json({
    marketStatus: getMarketStatus(),
    isMarketOpen: isMarketOpen(),
    stocks:       state.stocks.size,
    version:      state.version,
    lastUpdate:   state.lastUpdateTime,
  });
});

// ── Market Data ────────────────────────────────────────────────────────

router.get('/market', (req, res) => {
  const state  = getState();
  const stocks = state.getAllStocks();
  const indices = state.getAllIndices();

  res.json({
    stocks,
    indices,
    version:      state.version,
    timestamp:    state.lastUpdateTime,
    marketStatus: getMarketStatus(),
    totalStocks:  stocks.length,
  });
});

router.get('/stocks', (req, res) => {
  const state  = getState();
  let stocks   = state.getAllStocks();

  // Filtering
  const { sector, listed, search, minVol } = req.query;

  if (sector) {
    const s = sector.toLowerCase();
    stocks = stocks.filter(x => (x.sector || '').toLowerCase().includes(s));
  }
  if (listed) {
    stocks = stocks.filter(x => Array.isArray(x.listedIn) && x.listedIn.includes(listed.toUpperCase()));
  }
  if (search) {
    const q = search.toLowerCase();
    stocks = stocks.filter(x =>
      x.symbol.toLowerCase().includes(q) ||
      (x.companyName || '').toLowerCase().includes(q)
    );
  }
  if (minVol) {
    const mv = Number(minVol);
    if (Number.isFinite(mv)) stocks = stocks.filter(x => (x.volume || 0) >= mv);
  }

  // Sorting
  const { sort, order } = req.query;
  if (sort) {
    const dir = order === 'asc' ? 1 : -1;
    stocks = [...stocks].sort((a, b) => {
      const av = a[sort] ?? 0;
      const bv = b[sort] ?? 0;
      return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
    });
  }

  // Pagination
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const start = (page - 1) * limit;
  const items = stocks.slice(start, start + limit);

  res.json({
    stocks: items,
    total: stocks.length,
    page, limit,
    pages: Math.ceil(stocks.length / limit),
    timestamp: state.lastUpdateTime,
    version: state.version,
  });
});

router.get('/stocks/:symbol', (req, res) => {
  const state  = getState();
  const symbol = req.params.symbol.toUpperCase();
  const stock  = state.getStock(symbol);

  if (!stock) return res.status(404).json({ error: `Symbol ${symbol} not found` });
  res.json({ stock, timestamp: Date.now() });
});

// ── Indices ────────────────────────────────────────────────────────────

router.get('/indices', (req, res) => {
  const state = getState();
  res.json({
    indices:   state.getAllIndices(),
    kse100:    state.getIndex('KSE100'),
    kse30:     state.getIndex('KSE30'),
    timestamp: state.lastUpdateTime,
    version:   state.version,
  });
});

router.get('/indices/:name', (req, res) => {
  const state = getState();
  const name  = req.params.name.toUpperCase();
  const index = state.getIndex(name);
  if (!index) return res.status(404).json({ error: `Index ${name} not found` });
  res.json({ index, timestamp: Date.now() });
});

// ── Movers ────────────────────────────────────────────────────────────

router.get('/gainers', (req, res) => {
  const n = Math.min(50, Number(req.query.limit) || 10);
  res.json({ gainers: getState().getTopGainers(n), timestamp: Date.now() });
});

router.get('/losers', (req, res) => {
  const n = Math.min(50, Number(req.query.limit) || 10);
  res.json({ losers: getState().getTopLosers(n), timestamp: Date.now() });
});

router.get('/active', (req, res) => {
  const n = Math.min(50, Number(req.query.limit) || 10);
  res.json({ active: getState().getMostActive(n), timestamp: Date.now() });
});

// ── Candles ────────────────────────────────────────────────────────────

router.get('/candles/:symbol', (req, res) => {
  const state    = getState();
  const symbol   = req.params.symbol.toUpperCase();
  const interval = Number(req.query.interval) || 60; // seconds
  const limit    = Math.min(500, Number(req.query.limit) || 200);

  const candles = state.getCandles(symbol, interval, limit);
  res.json({ symbol, interval, candles, count: candles.length, timestamp: Date.now() });
});

// ── Tick History ──────────────────────────────────────────────────────

router.get('/ticks/:symbol', (req, res) => {
  const state  = getState();
  const symbol = req.params.symbol.toUpperCase();
  const since  = req.query.since ? Number(req.query.since) : null;

  const ticks = state.getTickHistory(symbol, since);
  res.json({ symbol, ticks, count: ticks.length, timestamp: Date.now() });
});

// ── Stats ─────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  res.json({ ...getState().getStats(), marketStatus: getMarketStatus(), serverTime: new Date().toISOString() });
});

module.exports = router;
