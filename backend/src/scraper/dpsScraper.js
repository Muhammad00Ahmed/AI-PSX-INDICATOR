'use strict';

/**
 * PSX DPS API Scraper
 * 
 * Uses https://dps.psx.com.pk — PSX's own data portal JSON API.
 * This is the fastest, most reliable source. No browser needed.
 * 
 * Endpoints:
 *   /market-watch        → full HTML table (requires Cheerio parsing)
 *   /symbols             → symbol metadata JSON
 *   /timeseries/int/KSE100 → index timeseries
 *   /timeseries/int/KSE30  → KSE-30 timeseries
 */

const axios = require('axios');
const cheerio = require('cheerio');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { validateTick, validateIndexTick } = require('../state/tickValidator');
const { parseNum, parseInt2, normSym } = require('../utils/numbers');
const { getAdaptivePollInterval } = require('../utils/marketSession');

const BASE_URL        = process.env.PSX_DPS_BASE_URL   || 'https://dps.psx.com.pk';
const MARKET_WATCH_URL = `${BASE_URL}/market-watch`;
const SYMBOLS_URL      = `${BASE_URL}/symbols`;
const KSE100_TS_URL   = `${BASE_URL}/timeseries/int/KSE100`;
const KSE30_TS_URL    = `${BASE_URL}/timeseries/int/KSE30`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PSXMarketEngine/2.0; +https://psx.com.pk)',
  'Accept': 'text/html,application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

class DPSScraper extends EventEmitter {
  constructor() {
    super();
    this.symbolMeta = new Map();       // symbol → { name, sector, isDebt, isETF, isGEM }
    this.lastPrices = new Map();       // symbol → last price (for delta detection)
    this.lastIndexValues = new Map();  // name → last value
    this.isRunning = false;
    this.pollTimer = null;
    this.symbolRefreshTimer = null;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 10;
    this.lastSuccessTime = 0;
    this.totalPolls = 0;
    this.successPolls = 0;
  }

  // ── Symbol Metadata ────────────────────────────────────────────────

  async fetchSymbolMetadata() {
    try {
      const { data } = await axios.get(SYMBOLS_URL, {
        timeout: 10000,
        headers: HEADERS,
      });

      const items = Array.isArray(data) ? data : [];
      items.forEach(item => {
        if (!item?.symbol) return;
        this.symbolMeta.set(normSym(item.symbol), {
          name:       String(item.name || item.symbol).trim(),
          sector:     String(item.sectorName || '').trim() || null,
          sectorCode: String(item.sectorCode || item.sector || '').trim() || null,
          isDebt:     Boolean(item.isDebt),
          isETF:      Boolean(item.isETF),
          isGEM:      Boolean(item.isGEM),
          listedIn:   Array.isArray(item.listedIn) ? item.listedIn.map(String) : [],
        });
      });

      logger.info({ count: this.symbolMeta.size }, 'DPS: symbol metadata loaded');
    } catch (err) {
      logger.warn({ err: err.message }, 'DPS: failed to fetch symbol metadata');
    }
  }

  // ── Market Watch (full HTML parse) ─────────────────────────────────

  async fetchMarketWatch() {
    const res = await axios.get(MARKET_WATCH_URL, {
      timeout: 15000,
      headers: { ...HEADERS, Accept: 'text/html' },
    });
    return res.data;
  }

  parseMarketWatchHTML(html) {
    const $ = cheerio.load(html);
    const ticks = [];
    const ts = Date.now();

    $('table.tbl tbody tr').each((_, tr) => {
      try {
        const $tr = $(tr);
        const cells = $tr.find('td');
        if (cells.length < 11) return;

        const $sym = cells.eq(0);
        const symbol = normSym($sym.attr('data-search') || $sym.text());
        if (!symbol) return;

        const meta = this.symbolMeta.get(symbol) || {};

        // Skip debt instruments unless configured otherwise
        if (meta.isDebt) return;

        const ldcp          = parseNum(cells.eq(3).attr('data-order') || cells.eq(3).text());
        const open          = parseNum(cells.eq(4).attr('data-order') || cells.eq(4).text());
        const high          = parseNum(cells.eq(5).attr('data-order') || cells.eq(5).text());
        const low           = parseNum(cells.eq(6).attr('data-order') || cells.eq(6).text());
        const close         = parseNum(cells.eq(7).attr('data-order') || cells.eq(7).text());
        const change        = parseNum(cells.eq(8).attr('data-order') || cells.eq(8).text());
        const changePct     = parseNum(cells.eq(9).attr('data-order') || cells.eq(9).text());
        const volume        = parseInt2(cells.eq(10).attr('data-order') || cells.eq(10).text());

        const rawTick = {
          symbol,
          companyName: meta.name || symbol,
          sector:      meta.sector || null,
          sectorCode:  meta.sectorCode || null,
          price:       close,
          ldcp,
          open,
          high,
          low,
          change:      change ?? 0,
          changePercent: changePct ?? 0,
          volume,
          timestamp:   ts,
          sequenceId:  ts,
          source:      'dps_api',
          isDebt:      meta.isDebt || false,
          isETF:       meta.isETF  || false,
          isGEM:       meta.isGEM  || false,
          listedIn:    meta.listedIn || [],
        };

        const validated = validateTick(rawTick, 'dps_api');
        if (validated) ticks.push(validated);
      } catch (rowErr) {
        // Per-row error — skip silently
      }
    });

    return ticks;
  }

  // ── Index Timeseries ───────────────────────────────────────────────

  async fetchIndexTimeseries(url, indexName) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: HEADERS,
      });

      const rows = data?.data;
      if (!Array.isArray(rows) || rows.length === 0) return null;

      const latest   = rows[rows.length - 1];
      const previous = rows.length > 1 ? rows[rows.length - 2] : rows[0];

      const value    = parseNum(latest[1]);
      const prevVal  = parseNum(previous[1]);
      const volume   = parseInt2(latest[2]);
      const ts       = Number(latest[0]) * 1000; // unix → ms

      if (!value || !prevVal) return null;

      const change        = parseNum((value - prevVal).toFixed(2));
      const changePercent = parseNum(((change / prevVal) * 100).toFixed(2));

      return validateIndexTick({
        value,
        change,
        changePercent,
        volume,
        timestamp: ts,
        sequenceId: ts,
        previousClose: prevVal,
      }, indexName, 'dps_timeseries');
    } catch (err) {
      logger.debug({ err: err.message, indexName }, 'DPS: index timeseries fetch failed');
      return null;
    }
  }

  // ── Core Poll Loop ─────────────────────────────────────────────────

  async poll() {
    this.totalPolls++;
    const start = Date.now();

    try {
      const html = await this.fetchMarketWatch();
      const ticks = this.parseMarketWatchHTML(html);

      if (ticks.length === 0) {
        logger.warn('DPS: parsed 0 ticks from market watch');
        this.consecutiveErrors++;
        return;
      }

      // Delta filtering — only emit changed ticks
      const changed = ticks.filter(t => {
        const last = this.lastPrices.get(t.symbol);
        return last === undefined || last !== t.price;
      });

      ticks.forEach(t => this.lastPrices.set(t.symbol, t.price));

      const latency = Date.now() - start;
      this.consecutiveErrors = 0;
      this.lastSuccessTime = Date.now();
      this.successPolls++;

      if (changed.length > 0) {
        this.emit('ticks', { ticks: changed, all: ticks, latency, source: 'dps_api' });
      }

      this.emit('heartbeat', { count: ticks.length, changed: changed.length, latency });

      // Fetch indices concurrently
      const [kse100, kse30] = await Promise.all([
        this.fetchIndexTimeseries(KSE100_TS_URL, 'KSE100'),
        this.fetchIndexTimeseries(KSE30_TS_URL,  'KSE30'),
      ]);

      const indexUpdates = [];
      if (kse100) {
        const last = this.lastIndexValues.get('KSE100');
        if (!last || last !== kse100.value) {
          this.lastIndexValues.set('KSE100', kse100.value);
          indexUpdates.push(kse100);
        }
      }
      if (kse30) {
        const last = this.lastIndexValues.get('KSE30');
        if (!last || last !== kse30.value) {
          this.lastIndexValues.set('KSE30', kse30.value);
          indexUpdates.push(kse30);
        }
      }

      if (indexUpdates.length > 0) {
        this.emit('indices', { indices: indexUpdates });
      }

    } catch (err) {
      this.consecutiveErrors++;
      logger.error({ err: err.message, consecutive: this.consecutiveErrors }, 'DPS poll error');

      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        logger.error('DPS: too many consecutive errors, emitting error event');
        this.emit('error', new Error(`DPS scraper failed ${this.consecutiveErrors} times consecutively`));
        this.consecutiveErrors = 0; // reset to allow recovery
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Load symbol metadata first
    await this.fetchSymbolMetadata();

    // Refresh symbol metadata every 30 minutes
    this.symbolRefreshTimer = setInterval(() => this.fetchSymbolMetadata(), 30 * 60 * 1000);

    // Adaptive poll loop
    const schedule = () => {
      if (!this.isRunning) return;
      const interval = getAdaptivePollInterval();
      this.pollTimer = setTimeout(async () => {
        await this.poll();
        schedule(); // reschedule after completion
      }, interval);
    };

    // First poll immediately
    await this.poll();
    schedule();

    logger.info('DPS scraper started');
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer)         clearTimeout(this.pollTimer);
    if (this.symbolRefreshTimer) clearInterval(this.symbolRefreshTimer);
    logger.info('DPS scraper stopped');
  }

  getHealth() {
    return {
      isRunning:         this.isRunning,
      consecutiveErrors: this.consecutiveErrors,
      lastSuccessTime:   this.lastSuccessTime,
      totalPolls:        this.totalPolls,
      successPolls:      this.successPolls,
      symbolCount:       this.symbolMeta.size,
      trackedSymbols:    this.lastPrices.size,
      successRate:       this.totalPolls > 0
        ? Math.round((this.successPolls / this.totalPolls) * 100)
        : 0,
    };
  }
}

module.exports = DPSScraper;
