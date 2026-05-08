'use strict';

/**
 * Playwright Browser Scraper
 * 
 * Persistent Chromium instance — page stays hot-loaded.
 * Uses MutationObserver injected into the page for instant DOM change detection.
 * Fallback to polling if no mutation detected within timeout.
 * 
 * Target: https://www.psx.com.pk/market-watch
 */

const { chromium } = require('playwright');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { validateTick } = require('../state/tickValidator');
const { parseInt2, normSym } = require('../utils/numbers');

const PSX_WEB_URL = process.env.PSX_WEB_URL || 'https://www.psx.com.pk/market-watch';
const BROWSER_TIMEOUT   = Number(process.env.BROWSER_TIMEOUT)   || 30000;
const MUTATION_TIMEOUT  = 1500;   // wait up to 1.5s for DOM mutations
const MAX_RESTART_DELAY = 30000;  // cap restart backoff at 30s

// DOM selectors with fallbacks
const SELECTORS = {
  primary:  'table#mainTable tbody tr',
  fallback: 'table.tbl tbody tr',
  generic:  'tbody tr[data-symbol]',
};

// Cell index mapping (0-based) — adjust if PSX redesigns their table
const CELL_MAP = {
  symbol:     0,
  sector:     1,
  ldcp:       3,
  open:       4,
  high:       5,
  low:        6,
  close:      7,
  change:     8,
  changePct:  9,
  volume:     10,
};

/**
 * DOM extraction script injected into browser page.
 * Runs in the page's JS context — very fast with direct property access.
 */
const EXTRACTION_SCRIPT = (cellMap) => `
  (function() {
    const results = [];
    const now = Date.now();

    // Try multiple selector strategies
    const selectors = [
      'table#mainTable tbody tr',
      'table.tbl tbody tr',
      'tbody tr[data-symbol]',
      'tbody tr',
    ];

    let rows = null;
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 5) { rows = found; break; }
    }

    if (!rows) return results;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.children;
      if (cells.length < 11) continue;

      const symCell = cells[${cellMap.symbol}];
      const symbol = (symCell.getAttribute('data-search') || symCell.textContent || '').trim().toUpperCase();
      if (!symbol || symbol.length > 10) continue;

      const getNum = (cellIdx) => {
        const c = cells[cellIdx];
        if (!c) return null;
        const raw = c.getAttribute('data-order') || c.textContent || '';
        const n = parseFloat(raw.replace(/,/g, '').trim());
        return isFinite(n) ? n : null;
      };

      const getInt = (cellIdx) => {
        const c = cells[cellIdx];
        if (!c) return 0;
        const raw = c.getAttribute('data-order') || c.textContent || '';
        const n = parseInt(raw.replace(/,/g, '').trim(), 10);
        return isFinite(n) ? n : 0;
      };

      const close = getNum(${cellMap.close});
      if (!close || close <= 0) continue;

      results.push({
        symbol,
        price: close,
        ldcp: getNum(${cellMap.ldcp}),
        open: getNum(${cellMap.open}),
        high: getNum(${cellMap.high}),
        low:  getNum(${cellMap.low}),
        change:    getNum(${cellMap.change})   || 0,
        changePct: getNum(${cellMap.changePct}) || 0,
        volume:    getInt(${cellMap.volume}),
        timestamp: now,
        sequenceId: now,
      });
    }

    return results;
  })()
`;

const MUTATION_OBSERVER_SCRIPT = `
  if (!window.__PSX_MO) {
    window.__PSX_CHANGED = false;
    const obs = new MutationObserver(() => { window.__PSX_CHANGED = true; });
    const target = document.querySelector('table#mainTable tbody') 
                || document.querySelector('table.tbl tbody')
                || document.querySelector('tbody');
    if (target) {
      obs.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
      window.__PSX_MO = obs;
      true;
    } else {
      false;
    }
  } else {
    true;
  }
`;

class PlaywrightScraper extends EventEmitter {
  constructor() {
    super();
    this.browser   = null;
    this.page      = null;
    this.isRunning = false;
    this.restartCount  = 0;
    this.restartDelay  = 5000;
    this.lastPrices    = new Map();
    this.totalExtracts = 0;
    this.successExtracts = 0;
    this.lastSuccessTime = 0;
  }

  // ── Browser Lifecycle ──────────────────────────────────────────────

  async launchBrowser() {
    logger.info('Playwright: launching browser');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
      ],
    });
  }

  async launchPage() {
    const ctx = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; PSXMarketEngine/2.0)',
      viewport:  { width: 1280, height: 900 },
    });

    this.page = await ctx.newPage();

    // Block unnecessary resources for speed
    await this.page.route('**/*', (route) => {
      const type = route.request().resourceType();
      const url  = route.request().url();
      if (['image', 'font', 'media', 'manifest'].includes(type)) {
        return route.abort();
      }
      // Block analytics and trackers
      if (/google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|mixpanel/i.test(url)) {
        return route.abort();
      }
      return route.continue();
    });

    // Navigate to PSX market watch
    await this.page.goto(PSX_WEB_URL, {
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT,
    });

    // Wait for table rows to appear
    await this.page.waitForSelector('tbody tr', { timeout: BROWSER_TIMEOUT }).catch(() => {
      logger.warn('Playwright: no tbody tr found, proceeding anyway');
    });

    // Inject MutationObserver
    const moOk = await this.page.evaluate(MUTATION_OBSERVER_SCRIPT).catch(() => false);
    logger.info({ moOk }, 'Playwright: page ready, MutationObserver installed');
  }

  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launchBrowser();
    }
    if (!this.page || this.page.isClosed()) {
      await this.launchPage();
    }
  }

  // ── Extraction ─────────────────────────────────────────────────────

  async extract() {
    this.totalExtracts++;
    const raw = await this.page.evaluate(EXTRACTION_SCRIPT(CELL_MAP));

    if (!Array.isArray(raw) || raw.length === 0) return [];

    const ts = Date.now();
    const ticks = [];

    for (const item of raw) {
      const validated = validateTick({
        symbol:       item.symbol,
        price:        item.price,
        ldcp:         item.ldcp,
        open:         item.open,
        high:         item.high,
        low:          item.low,
        change:       item.change,
        changePercent: item.changePct,
        volume:       item.volume,
        timestamp:    ts,
        sequenceId:   ts,
      }, 'playwright');

      if (validated) ticks.push(validated);
    }

    return ticks;
  }

  // ── Main Loop ──────────────────────────────────────────────────────

  async loop() {
    while (this.isRunning) {
      try {
        await this.ensureBrowser();

        // Wait for DOM mutation OR timeout
        try {
          await this.page.waitForFunction(
            () => window.__PSX_CHANGED === true,
            { timeout: MUTATION_TIMEOUT }
          );
        } catch (_) {
          // Timeout is fine — we poll anyway
        }

        // Reset flag
        await this.page.evaluate(() => { window.__PSX_CHANGED = false; }).catch(() => {});

        const ticks = await this.extract();

        if (ticks.length === 0) {
          logger.debug('Playwright: 0 ticks extracted');
          await this._sleep(2000);
          continue;
        }

        // Delta detection
        const changed = ticks.filter(t => {
          const last = this.lastPrices.get(t.symbol);
          return last === undefined || last !== t.price;
        });

        ticks.forEach(t => this.lastPrices.set(t.symbol, t.price));

        this.successExtracts++;
        this.lastSuccessTime = Date.now();

        if (changed.length > 0) {
          this.emit('ticks', { ticks: changed, all: ticks, source: 'playwright' });
        }

        this.emit('heartbeat', { count: ticks.length, changed: changed.length });

      } catch (err) {
        logger.error({ err: err.message }, 'Playwright loop error');
        await this._sleep(3000);
        await this._attemptRecovery();
      }
    }
  }

  async _attemptRecovery() {
    this.restartCount++;
    const delay = Math.min(this.restartDelay * this.restartCount, MAX_RESTART_DELAY);
    logger.info({ delay, restartCount: this.restartCount }, 'Playwright: attempting browser recovery');

    try {
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      if (this.browser && this.browser.isConnected()) await this.browser.close().catch(() => {});
    } catch (_) {}

    this.browser = null;
    this.page    = null;

    await this._sleep(delay);
    this.restartDelay = Math.min(this.restartDelay * 1.5, MAX_RESTART_DELAY);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.launchBrowser();
      await this.launchPage();
    } catch (err) {
      logger.error({ err: err.message }, 'Playwright: initial launch failed');
      this.emit('error', err);
    }

    this.loop(); // runs in background
    logger.info('Playwright scraper started');
  }

  async stop() {
    this.isRunning = false;
    try {
      if (this.page)    await this.page.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
    } catch (_) {}
    logger.info('Playwright scraper stopped');
  }

  getHealth() {
    return {
      isRunning:        this.isRunning,
      restartCount:     this.restartCount,
      lastSuccessTime:  this.lastSuccessTime,
      totalExtracts:    this.totalExtracts,
      successExtracts:  this.successExtracts,
      trackedSymbols:   this.lastPrices.size,
      browserConnected: this.browser?.isConnected() ?? false,
      pageOpen:         this.page ? !this.page.isClosed() : false,
      successRate:      this.totalExtracts > 0
        ? Math.round((this.successExtracts / this.totalExtracts) * 100)
        : 0,
    };
  }
}

module.exports = PlaywrightScraper;
