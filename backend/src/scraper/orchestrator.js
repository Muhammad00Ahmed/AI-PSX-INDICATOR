'use strict';

/**
 * Scraper Pipeline Orchestrator
 * 
 * Coordinates DPS API scraper (primary) and Playwright scraper (secondary).
 * Feeds validated ticks into MarketStateManager.
 * Handles failover, deduplication, and rate limiting.
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');
const { getState } = require('../state/marketState');
const DPSScraper = require('./dpsScraper');

let PlaywrightScraper = null;
if (process.env.ENABLE_PLAYWRIGHT !== 'false') {
  try {
    PlaywrightScraper = require('./playwrightScraper');
  } catch (_) {
    logger.warn('Playwright not available — using API-only mode');
  }
}

class ScraperOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.state    = getState();
    this.dps      = new DPSScraper();
    this.pw       = PlaywrightScraper ? new PlaywrightScraper() : null;

    this.dpsActive = true;
    this.pwActive  = false;

    this.ticksApplied   = 0;
    this.batchesApplied = 0;
    this.lastBatchTime  = 0;

    this._wireDPS();
    if (this.pw) this._wirePW();
  }

  _wireDPS() {
    this.dps.on('ticks', ({ ticks, latency }) => {
      const updated = this.state.applyBatch(ticks);
      this.ticksApplied += updated;
      this.batchesApplied++;
      this.lastBatchTime = Date.now();

      if (updated > 0) {
        this.emit('update', { source: 'dps', updated, latency });
      }
    });

    this.dps.on('indices', ({ indices }) => {
      indices.forEach(idx => this.state.applyIndexTick(idx));
      this.emit('indices', { indices });
    });

    this.dps.on('heartbeat', ({ count, changed, latency }) => {
      this.emit('heartbeat', { source: 'dps', count, changed, latency });
    });

    this.dps.on('error', (err) => {
      logger.error({ err: err.message }, 'DPS scraper error — may activate Playwright');
      if (this.pw && !this.pwActive) {
        logger.info('Activating Playwright as DPS fallback');
        this.pw.start().catch(e => logger.error({ e: e.message }, 'Playwright fallback start failed'));
        this.pwActive = true;
      }
    });
  }

  _wirePW() {
    this.pw.on('ticks', ({ ticks, source }) => {
      // Only use Playwright data if DPS is down or for enrichment
      if (!this.dps.isRunning || this.dps.consecutiveErrors > 3) {
        const updated = this.state.applyBatch(ticks);
        this.ticksApplied += updated;
        if (updated > 0) {
          this.emit('update', { source: 'playwright', updated });
        }
      }
    });

    this.pw.on('error', (err) => {
      logger.error({ err: err.message }, 'Playwright scraper error');
    });
  }

  async start() {
    logger.info('Scraper orchestrator starting');

    // Always start DPS (primary, fastest)
    await this.dps.start();

    // Optionally start Playwright in parallel for enrichment
    if (this.pw && process.env.ENABLE_PLAYWRIGHT === 'true') {
      logger.info('Starting Playwright scraper (secondary)');
      this.pw.start().catch(err => {
        logger.warn({ err: err.message }, 'Playwright failed to start, continuing with DPS only');
      });
      this.pwActive = true;
    }

    logger.info('Scraper orchestrator started');
  }

  async stop() {
    this.dps.stop();
    if (this.pw) await this.pw.stop();
    logger.info('Scraper orchestrator stopped');
  }

  getHealth() {
    return {
      dps:        this.dps.getHealth(),
      playwright: this.pw ? this.pw.getHealth() : null,
      ticksApplied:   this.ticksApplied,
      batchesApplied: this.batchesApplied,
      lastBatchTime:  this.lastBatchTime,
    };
  }
}

// Singleton
let _instance = null;
function getOrchestrator() {
  if (!_instance) _instance = new ScraperOrchestrator();
  return _instance;
}

module.exports = { ScraperOrchestrator, getOrchestrator };
