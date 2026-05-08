'use strict';

/**
 * Watchdog Monitor
 * 
 * Monitors scraper health, data freshness, and system metrics.
 * Auto-restarts stalled scrapers.
 * Exposes structured metrics.
 */

const logger = require('../utils/logger');
const { getState }        = require('../state/marketState');
const { getOrchestrator } = require('../scraper/orchestrator');
const { isMarketOpen }    = require('../utils/marketSession');

const STALE_THRESHOLD_MS  = Number(process.env.STALE_DATA_THRESHOLD) || 30000;
const WATCHDOG_INTERVAL   = Number(process.env.WATCHDOG_INTERVAL)    || 60000;

class Watchdog {
  constructor() {
    this.state     = getState();
    this.metrics   = {
      checks:        0,
      staleDetected: 0,
      restarts:      0,
      lastCheck:     0,
    };
    this._interval = null;
  }

  start() {
    this._interval = setInterval(() => this._check(), WATCHDOG_INTERVAL);
    logger.info({ interval: WATCHDOG_INTERVAL }, 'Watchdog started');
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    logger.info('Watchdog stopped');
  }

  async _check() {
    this.metrics.checks++;
    this.metrics.lastCheck = Date.now();

    const marketOpen = isMarketOpen();
    const stats      = this.state.getStats();
    const orch       = getOrchestrator();
    const health     = orch.getHealth();

    // ── Data Freshness ───────────────────────────────────────────────
    if (marketOpen && stats.lastUpdate > 0) {
      const staleness = Date.now() - stats.lastUpdate;
      if (staleness > STALE_THRESHOLD_MS) {
        this.metrics.staleDetected++;
        logger.warn({ staleness, threshold: STALE_THRESHOLD_MS }, 'Watchdog: stale data detected');

        // Attempt to force a refresh by restarting DPS
        try {
          logger.info('Watchdog: triggering DPS re-poll');
          orch.dps.poll();
        } catch (e) {
          logger.error({ e: e.message }, 'Watchdog: force poll failed');
        }
      }
    }

    // ── DPS Health ───────────────────────────────────────────────────
    const dpsHealth = health.dps;
    if (dpsHealth && !dpsHealth.isRunning && marketOpen) {
      logger.warn('Watchdog: DPS scraper not running during market hours — restarting');
      try {
        await orch.dps.start();
        this.metrics.restarts++;
      } catch (e) {
        logger.error({ e: e.message }, 'Watchdog: DPS restart failed');
      }
    }

    // ── Memory ──────────────────────────────────────────────────────
    const mem = process.memoryUsage();
    if (mem.heapUsed > 500 * 1024 * 1024) { // 500MB
      logger.warn({ heapMB: Math.round(mem.heapUsed / 1024 / 1024) }, 'Watchdog: high memory usage');
    }

    logger.debug({
      stocks:      stats.totalStocks,
      version:     stats.version,
      lastUpdate:  stats.lastUpdate,
      marketOpen,
      heapMB:      Math.round(mem.heapUsed / 1024 / 1024),
    }, 'Watchdog check');
  }

  getMetrics() {
    const mem = process.memoryUsage();
    return {
      ...this.metrics,
      heapUsedMB:  Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      uptimeSec:   Math.round(process.uptime()),
      state:       this.state.getStats(),
    };
  }
}

let _instance = null;
function getWatchdog() {
  if (!_instance) _instance = new Watchdog();
  return _instance;
}

module.exports = { Watchdog, getWatchdog };
