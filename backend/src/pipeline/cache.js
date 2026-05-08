'use strict';

/**
 * Redis Cache Layer
 * 
 * Caches market snapshots, tick history, and candles.
 * Gracefully degrades if Redis is unavailable — system runs in-memory only.
 */

let Redis = null;
try { Redis = require('ioredis'); } catch (_) {}

const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TTL_SNAPSHOT   = 60;         // 1 minute
const TTL_TICK_HIST  = 3600;       // 1 hour
const TTL_CANDLES    = 86400;      // 1 day

const KEYS = {
  snapshot:    'psx:snapshot',
  indices:     'psx:indices',
  tickHistory: (sym) => `psx:ticks:${sym}`,
  candles:     (sym, int) => `psx:candles:${sym}:${int}`,
  stats:       'psx:stats',
};

class CacheLayer {
  constructor() {
    this.client  = null;
    this.enabled = false;
    this._connect();
  }

  async _connect() {
    if (!Redis) {
      logger.info('ioredis not installed — cache disabled');
      return;
    }

    try {
      this.client = new Redis(REDIS_URL, {
        lazyConnect:       true,
        connectTimeout:    5000,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        retryStrategy: (times) => times > 5 ? null : Math.min(times * 500, 5000),
      });

      this.client.on('connect',   () => { this.enabled = true;  logger.info('Redis connected'); });
      this.client.on('close',     () => { this.enabled = false; logger.warn('Redis disconnected'); });
      this.client.on('error',     (e) => { this.enabled = false; logger.debug({ e: e.message }, 'Redis error'); });

      await this.client.connect();
    } catch (err) {
      logger.warn({ err: err.message }, 'Redis unavailable — running in-memory only');
      this.enabled = false;
    }
  }

  _ok() { return this.enabled && this.client; }

  async setSnapshot(snapshot) {
    if (!this._ok()) return;
    try {
      await this.client.setex(KEYS.snapshot, TTL_SNAPSHOT, JSON.stringify(snapshot));
    } catch (e) { /* ignore */ }
  }

  async getSnapshot() {
    if (!this._ok()) return null;
    try {
      const raw = await this.client.get(KEYS.snapshot);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  async setCandles(symbol, intervalSec, candles) {
    if (!this._ok()) return;
    try {
      const key = KEYS.candles(symbol, intervalSec);
      await this.client.setex(key, TTL_CANDLES, JSON.stringify(candles));
    } catch (_) {}
  }

  async getCandles(symbol, intervalSec) {
    if (!this._ok()) return null;
    try {
      const key = KEYS.candles(symbol, intervalSec);
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  async appendTick(symbol, tick) {
    if (!this._ok()) return;
    try {
      const key = KEYS.tickHistory(symbol);
      const small = JSON.stringify({ t: tick.timestamp, p: tick.price, v: tick.volume, c: tick.change });
      await this.client
        .multi()
        .rpush(key, small)
        .ltrim(key, -1440, -1) // keep last 1440
        .expire(key, TTL_TICK_HIST)
        .exec();
    } catch (_) {}
  }

  async getTickHistory(symbol) {
    if (!this._ok()) return [];
    try {
      const key = KEYS.tickHistory(symbol);
      const items = await this.client.lrange(key, 0, -1);
      return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch (_) { return []; }
  }

  async publishEvent(channel, data) {
    if (!this._ok()) return;
    try {
      await this.client.publish(channel, JSON.stringify(data));
    } catch (_) {}
  }

  async healthCheck() {
    if (!this._ok()) return { ok: false, reason: 'disabled' };
    try {
      const pong = await this.client.ping();
      return { ok: pong === 'PONG', latency: 0 };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async disconnect() {
    if (this.client) await this.client.quit().catch(() => {});
  }
}

// Singleton
let _instance = null;
function getCache() {
  if (!_instance) _instance = new CacheLayer();
  return _instance;
}

module.exports = { CacheLayer, getCache, KEYS };
