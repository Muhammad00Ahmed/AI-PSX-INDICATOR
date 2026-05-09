'use strict';

const EventEmitter = require('events');
const logger = require('../utils/logger');
const { round } = require('../utils/numbers');

const MAX_TICKS_PER_SYMBOL = Number(process.env.MAX_TICKS_PER_SYMBOL) || 1440;
const CANDLE_INTERVALS_SEC = (process.env.CANDLE_INTERVALS || '60,300,900,3600,14400,86400')
  .split(',').map(Number).filter(Boolean);

/**
 * Per-symbol circular tick buffer for history and candle generation.
 */
class TickBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.ticks = [];
    this.head = 0;
    this.size = 0;
  }

  push(tick) {
    if (this.size < this.maxSize) {
      this.ticks.push(tick);
      this.size++;
    } else {
      this.ticks[this.head] = tick;
      this.head = (this.head + 1) % this.maxSize;
    }
  }

  /** Returns ticks oldest-first */
  all() {
    if (this.size < this.maxSize) return [...this.ticks];
    const ordered = [];
    for (let i = 0; i < this.maxSize; i++) {
      ordered.push(this.ticks[(this.head + i) % this.maxSize]);
    }
    return ordered;
  }

  last() {
    if (this.size === 0) return null;
    const idx = this.size < this.maxSize
      ? this.size - 1
      : (this.head - 1 + this.maxSize) % this.maxSize;
    return this.ticks[idx];
  }

  sinceTs(ts) {
    return this.all().filter(t => t.timestamp >= ts);
  }
}

/**
 * Candle (OHLCV) generator for a given interval in seconds.
 */
class CandleEngine {
  constructor(intervalSec) {
    this.interval = intervalSec * 1000;
    this.candles = new Map(); // symbol → candle[]
    this.current = new Map(); // symbol → open candle
  }

  processTick(symbol, tick) {
    const bucketStart = Math.floor(tick.timestamp / this.interval) * this.interval;

    let cur = this.current.get(symbol);

    if (cur && cur.time !== bucketStart) {
      // Close and archive previous candle
      const closed = this._closeCandle(symbol);
      if (closed) {
        const list = this.candles.get(symbol) || [];
        list.push(closed);
        // Keep last 500 candles per symbol
        if (list.length > 500) list.shift();
        this.candles.set(symbol, list);
      }
      cur = null;
    }

    if (!cur) {
      cur = {
        time: bucketStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume || 0,
        count: 1,
      };
    } else {
      cur.high = Math.max(cur.high, tick.price);
      cur.low = Math.min(cur.low, tick.price);
      cur.close = tick.price;
      cur.volume += (tick.volume || 0);
      cur.count++;
    }

    this.current.set(symbol, cur);
    return cur;
  }

  _closeCandle(symbol) {
    const cur = this.current.get(symbol);
    if (!cur) return null;
    this.current.delete(symbol);
    return { ...cur };
  }

  getCandles(symbol, limit = 200) {
    const hist = this.candles.get(symbol) || [];
    const cur  = this.current.get(symbol);
    const all  = cur ? [...hist, cur] : hist;
    return all.slice(-limit);
  }

  getAllCurrentCandles() {
    const result = {};
    this.current.forEach((c, sym) => { result[sym] = c; });
    return result;
  }
}

/**
 * Global Market State — single source of truth.
 * All scraper outputs flow through here.
 * Emits events for WebSocket broadcasting.
 */
class MarketStateManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);

    // Primary stock map: symbol → enriched stock object
    this.stocks = new Map();
    // Index map: name → index object
    this.indices = new Map();
    // Per-symbol tick history
    this.tickHistory = new Map();
    // Candle engines per interval
    this.candleEngines = CANDLE_INTERVALS_SEC.map(s => ({
      intervalSec: s,
      engine: new CandleEngine(s),
    }));

    this.version = 0;
    this.lastUpdateTime = 0;
    this.totalTicksProcessed = 0;
    this.rejectedTicks = 0;
    this.startTime = Date.now();

    logger.info({ candle_intervals: CANDLE_INTERVALS_SEC }, 'MarketStateManager initialised');
  }

  // ── Stock Updates ───────────────────────────────────────────────────

  /**
   * Apply a single validated tick. Returns true if state changed.
   * Enforces "latest tick wins" using sequenceId then timestamp.
   */
  applyTick(tick) {
    this.totalTicksProcessed++;

    const sym = tick.symbol;
    const existing = this.stocks.get(sym);

    if (existing) {
      const newSeq = tick.sequenceId || tick.timestamp;
      const curSeq = existing.sequenceId || existing.timestamp;
      if (newSeq <= curSeq) {
        this.rejectedTicks++;
        return false; // stale
      }
    }

    // Preserve company meta from existing if tick is partial
    const enriched = {
      ...existing,
      ...tick,
      companyName: tick.companyName || (existing && existing.companyName) || tick.symbol,
      sector:      tick.sector      || (existing && existing.sector)      || null,
      sectorCode:  tick.sectorCode  || (existing && existing.sectorCode)  || null,
    };

    this.stocks.set(sym, enriched);
    this._recordTick(sym, enriched);
    this._updateCandles(sym, enriched);
    this.version++;
    this.lastUpdateTime = Date.now();

    this.emit('tick', { symbol: sym, data: enriched, version: this.version });
    return true;
  }

  /**
   * Apply a batch of validated ticks. Returns count of updated symbols.
   */
  applyBatch(ticks) {
    const ts = Date.now();
    let updated = 0;
    const updatedSymbols = [];

    for (const tick of ticks) {
      if (this.applyTick(tick)) {
        updated++;
        updatedSymbols.push(tick.symbol);
      }
    }

    if (updated > 0) {
      this.emit('batch', { updated, symbols: updatedSymbols, ts, version: this.version });
    }

    return updated;
  }

  /**
   * Apply a bulk snapshot (e.g. full market-watch response).
   * Merges intelligently, preferring newer data.
   */
  applySnapshot(ticks) {
    let updated = 0;
    for (const tick of ticks) {
      if (this.applyTick(tick)) updated++;
    }
    logger.info({ total: ticks.length, updated }, 'Snapshot applied');
    this.emit('snapshot', { updated, version: this.version });
    return updated;
  }

  // ── Index Updates ──────────────────────────────────────────────────

  applyIndexTick(indexTick) {
    const name = indexTick.name;
    const existing = this.indices.get(name);

    if (existing) {
      const newSeq = indexTick.sequenceId || indexTick.timestamp;
      const curSeq = existing.sequenceId  || existing.timestamp;
      if (newSeq <= curSeq) return false;
    }

    this.indices.set(name, indexTick);
    this.version++;
    this.lastUpdateTime = Date.now();
    this.emit('index', { name, data: indexTick, version: this.version });
    return true;
  }

  // ── Tick History & Candles ─────────────────────────────────────────

  _recordTick(symbol, tick) {
    let buf = this.tickHistory.get(symbol);
    if (!buf) {
      buf = new TickBuffer(MAX_TICKS_PER_SYMBOL);
      this.tickHistory.set(symbol, buf);
    }
    buf.push({ t: tick.timestamp, p: tick.price, v: tick.volume, c: tick.change });
  }

  _updateCandles(symbol, tick) {
    for (const { engine } of this.candleEngines) {
      engine.processTick(symbol, tick);
    }
  }

  getCandles(symbol, intervalSec, limit = 200) {
    const entry = this.candleEngines.find(e => e.intervalSec === intervalSec);
    if (!entry) return [];
    return entry.engine.getCandles(symbol.toUpperCase(), limit);
  }

  getTickHistory(symbol, since) {
    const buf = this.tickHistory.get(symbol.toUpperCase());
    if (!buf) return [];
    return since ? buf.sinceTs(since) : buf.all();
  }

  // ── Queries ────────────────────────────────────────────────────────

  getStock(symbol) {
    return this.stocks.get(symbol.toUpperCase()) || null;
  }

  getAllStocks() {
    return Array.from(this.stocks.values());
  }

  getIndex(name) {
    return this.indices.get(name.toUpperCase()) || null;
  }

  getAllIndices() {
    return Array.from(this.indices.values());
  }

  getTopGainers(n = 10) {
    return Array.from(this.stocks.values())
      .filter(s => s.changePercent != null)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, n);
  }

  getTopLosers(n = 10) {
    return Array.from(this.stocks.values())
      .filter(s => s.changePercent != null)
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, n);
  }

  getMostActive(n = 10) {
    return Array.from(this.stocks.values())
      .filter(s => s.volume > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, n);
  }

  getSnapshot() {
    return {
      stocks: this.getAllStocks(),
      indices: this.getAllIndices(),
      version: this.version,
      timestamp: this.lastUpdateTime,
      totalStocks: this.stocks.size,
      totalIndices: this.indices.size,
    };
  }

  getStats() {
    const stocks = this.getAllStocks();
    const gainers = stocks.filter(s => (s.changePercent ?? 0) > 0).length;
    const losers  = stocks.filter(s => (s.changePercent ?? 0) < 0).length;
    const totalVolume = stocks.reduce((s, x) => s + (x.volume || 0), 0);
    const uptimeMs = Date.now() - this.startTime;
    return {
      totalStocks: stocks.size,
      totalIndices: this.indices.size,
      gainers,
      losers,
      unchanged: stocks.length - gainers - losers,
      totalVolume,
      version: this.version,
      lastUpdate: this.lastUpdateTime,
      totalTicksProcessed: this.totalTicksProcessed,
      rejectedTicks: this.rejectedTicks,
      uptimeMs,
      tickAcceptanceRate: this.totalTicksProcessed > 0
        ? round((1 - this.rejectedTicks / this.totalTicksProcessed) * 100)
        : 100,
    };
  }

  /** Validate internal consistency — returns error list or null */
  validate() {
    const errors = [];
    this.stocks.forEach((stock, sym) => {
      if (stock.symbol !== sym) errors.push(`Symbol key mismatch: ${sym}`);
      if (stock.price <= 0 || !Number.isFinite(stock.price)) errors.push(`Bad price: ${sym}`);
      if (stock.high && stock.low && stock.high < stock.low) errors.push(`H<L: ${sym}`);
    });
    return errors.length ? errors : null;
  }
}

// Singleton
let _instance = null;
function getState() {
  if (!_instance) _instance = new MarketStateManager();
  return _instance;
}

module.exports = { MarketStateManager, getState };
