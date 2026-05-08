'use strict';

/**
 * WebSocket Broadcast Server
 * 
 * Features:
 * - Per-symbol subscription system
 * - Delta updates (only changed symbols)
 * - Client heartbeat with pong timeout
 * - Backpressure handling
 * - Efficient binary-safe JSON serialization
 */

const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getState } = require('../state/marketState');
const { getMarketStatus } = require('../utils/marketSession');

const WS_HEARTBEAT_INTERVAL = Number(process.env.WS_HEARTBEAT_INTERVAL) || 15000;
const WS_MAX_PAYLOAD        = Number(process.env.WS_MAX_PAYLOAD)        || 524288; // 512KB

// Message types (mirrored in frontend)
const MSG = {
  INIT:           'INIT',
  TICK:           'TICK',
  TICK_BATCH:     'TICK_BATCH',
  INDEX_UPDATE:   'INDEX_UPDATE',
  SNAPSHOT:       'SNAPSHOT',
  HEARTBEAT:      'HEARTBEAT',
  ERROR:          'ERROR',
  SUBSCRIBE:      'SUBSCRIBE',
  UNSUBSCRIBE:    'UNSUBSCRIBE',
  MARKET_STATUS:  'MARKET_STATUS',
};

function makeMsg(type, payload, meta = {}) {
  return JSON.stringify({
    type,
    payload,
    ts: Date.now(),
    ...meta,
  });
}

class BroadcastServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({
      server: httpServer,
      maxPayload: WS_MAX_PAYLOAD,
    });

    this.state = getState();

    // client metadata map: ws → { subscriptions: Set, lastPong: ts, alive: bool }
    this.clients = new Map();

    this._setupWSS();
    this._setupStateListeners();
    this._startHeartbeat();

    logger.info('WebSocket broadcast server ready');
  }

  // ── WSS Setup ──────────────────────────────────────────────────────

  _setupWSS() {
    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      logger.info({ ip }, 'WS client connected');

      this.clients.set(ws, {
        subscriptions: new Set(), // empty = all symbols
        lastPong: Date.now(),
        alive: true,
        ip,
      });

      // Send full snapshot on connect
      this._sendSnapshot(ws);

      ws.on('message', (raw) => this._handleMessage(ws, raw));
      ws.on('pong',    ()    => {
        const meta = this.clients.get(ws);
        if (meta) { meta.lastPong = Date.now(); meta.alive = true; }
      });
      ws.on('close',  ()    => {
        this.clients.delete(ws);
        logger.info({ ip }, 'WS client disconnected');
      });
      ws.on('error',  (err) => {
        logger.debug({ err: err.message, ip }, 'WS client error');
        this.clients.delete(ws);
      });
    });
  }

  _sendSnapshot(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const snap = this.state.getSnapshot();
    const marketStatus = getMarketStatus();
    const msg = makeMsg(MSG.INIT, {
      stocks: snap.stocks,
      indices: snap.indices,
      marketStatus,
      version: snap.version,
      totalStocks: snap.totalStocks,
    });
    this._safeSend(ws, msg);
  }

  _handleMessage(ws, raw) {
    try {
      const msg = JSON.parse(raw.toString());
      const meta = this.clients.get(ws);
      if (!meta) return;

      switch (msg.type) {
        case MSG.SUBSCRIBE: {
          const syms = Array.isArray(msg.symbols) ? msg.symbols.map(s => String(s).toUpperCase()) : [];
          syms.forEach(s => meta.subscriptions.add(s));
          logger.debug({ syms }, 'WS: client subscribed');
          break;
        }
        case MSG.UNSUBSCRIBE: {
          const syms = Array.isArray(msg.symbols) ? msg.symbols.map(s => String(s).toUpperCase()) : [];
          syms.forEach(s => meta.subscriptions.delete(s));
          break;
        }
        default:
          break;
      }
    } catch (_) {
      /* ignore malformed */
    }
  }

  // ── State Event Listeners ──────────────────────────────────────────

  _setupStateListeners() {
    // Individual tick — broadcast only to interested clients
    this.state.on('tick', ({ symbol, data, version }) => {
      const msg = makeMsg(MSG.TICK, { symbol, data }, { version });
      this._broadcastToSubscribers(symbol, msg);
    });

    // Batch update — send as TICK_BATCH
    this.state.on('batch', ({ symbols, updated, ts, version }) => {
      if (symbols.length === 0) return;
      const stocks = symbols.map(s => this.state.getStock(s)).filter(Boolean);
      const msg = makeMsg(MSG.TICK_BATCH, { stocks, updated }, { version });
      this._broadcastAll(msg);
    });

    // Index update
    this.state.on('index', ({ name, data, version }) => {
      const msg = makeMsg(MSG.INDEX_UPDATE, { name, data }, { version });
      this._broadcastAll(msg);
    });

    // Full snapshot (e.g. after market open)
    this.state.on('snapshot', ({ version }) => {
      const snap = this.state.getSnapshot();
      const msg  = makeMsg(MSG.SNAPSHOT, snap, { version });
      this._broadcastAll(msg);
    });
  }

  // ── Broadcast Helpers ──────────────────────────────────────────────

  _broadcastAll(msg) {
    this.clients.forEach((meta, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        this._safeSend(ws, msg);
      }
    });
  }

  _broadcastToSubscribers(symbol, msg) {
    this.clients.forEach((meta, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // If subscription set is empty, client wants all updates
      if (meta.subscriptions.size === 0 || meta.subscriptions.has(symbol)) {
        this._safeSend(ws, msg);
      }
    });
  }

  _safeSend(ws, msg) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        // Check backpressure
        if (ws.bufferedAmount > WS_MAX_PAYLOAD * 2) {
          logger.warn('WS: client buffer full, dropping frame');
          return;
        }
        ws.send(msg);
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'WS send error');
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────

  _startHeartbeat() {
    this._heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const statusMsg = makeMsg(MSG.HEARTBEAT, {
        marketStatus: getMarketStatus(),
        version: this.state.version,
        stockCount: this.state.stocks.size,
        ts: now,
      });

      this.clients.forEach((meta, ws) => {
        if (!meta.alive) {
          // Client did not respond to last ping — terminate
          logger.debug({ ip: meta.ip }, 'WS: terminating unresponsive client');
          ws.terminate();
          this.clients.delete(ws);
          return;
        }

        meta.alive = false;
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          this._safeSend(ws, statusMsg);
        }
      });
    }, WS_HEARTBEAT_INTERVAL);
  }

  // ── Metrics ────────────────────────────────────────────────────────

  getStats() {
    return {
      connectedClients: this.clients.size,
      version: this.state.version,
    };
  }

  shutdown() {
    clearInterval(this._heartbeatInterval);
    this.wss.close();
    logger.info('WebSocket server shut down');
  }
}

module.exports = BroadcastServer;
