/**
 * PSX Live Data Source Integration
 * 
 * PRODUCTION: This module abstracts PSX market data feeds.
 * 
 * CONFIGURATION REQUIRED:
 * - For institutional-grade accuracy, use one of:
 *   1. PSX Official Market Data Feed (requires commercial license)
 *   2. Licensed data provider (Bloomberg, Reuters, etc.)
 *   3. Authorized broker WebSocket feed
 * 
 * Current implementation supports:
 * - Future PSX WebSocket API integration
 * - Real-time tick streaming
 * - Tick-by-tick validation
 */

const EventEmitter = require("events");

class PSXDataSource extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // WebSocket endpoint for PSX live feed
      wsUrl: config.wsUrl || process.env.PSX_WS_URL,
      // Polling endpoint as fallback
      apiUrl: config.apiUrl || process.env.PSX_API_URL,
      // Poll interval in ms (1-2 seconds for institutional grade)
      pollInterval: config.pollInterval || 1500,
      // Enable WebSocket (preferred)
      useWebSocket: config.useWebSocket !== false,
      // Fallback to polling if WS fails
      fallbackToPolling: config.fallbackToPolling !== false,
      // Reconnection attempts
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      reconnectDelay: config.reconnectDelay || 3000,
    };

    this.ws = null;
    this.pollTimer = null;
    this.reconnectAttempts = 0;
    this.lastSequenceId = {};
    this.isConnected = false;
    this.tickBuffer = new Map();
    this.pollingActive = false;

    this.initializeDataValidation();
  }

  initializeDataValidation() {
    this.strictSchema = {
      symbol: "string", // PSX ticker (e.g., "PSO", "HBL")
      price: "number", // Current market price > 0
      change: "number", // Can be positive or negative
      changePercent: "number",
      volume: "number",
      timestamp: "number", // Unix timestamp in milliseconds
      sequenceId: "number", // To prevent race conditions
      high: "number",
      low: "number",
      open: "number",
      volumeTraded: "number",
      lastUpdated: "number",
    };
  }

  /**
   * Validate and normalize a single tick
   * Ensures institutional-grade data quality
   */
  validateTick(tick) {
    if (!tick || typeof tick !== "object") return null;

    const symbol = String(tick.symbol || "").trim().toUpperCase();
    if (!symbol) return null;

    const price = parseFloat(tick.price);
    if (!Number.isFinite(price) || price <= 0) {
      console.warn(`[PSX] Invalid price for ${symbol}: ${tick.price}`);
      return null;
    }

    const timestamp = Number(tick.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      console.warn(`[PSX] Invalid timestamp for ${symbol}`);
      return null;
    }

    const sequenceId = Number(tick.sequenceId || 0);
    if (sequenceId > 0 && this.lastSequenceId[symbol] !== undefined) {
      if (sequenceId <= this.lastSequenceId[symbol]) {
        console.warn(`[PSX] Out-of-order tick for ${symbol} (seq: ${sequenceId})`);
        return null; // Reject out-of-order ticks
      }
    }
    this.lastSequenceId[symbol] = sequenceId;

    const normalized = {
      symbol,
      price,
      change: parseFloat(tick.change) || 0,
      changePercent: parseFloat(tick.changePercent) || 0,
      volume: Number(tick.volume) || 0,
      timestamp,
      sequenceId: sequenceId || timestamp, // Fallback to timestamp
      high: parseFloat(tick.high) || null,
      low: parseFloat(tick.low) || null,
      open: parseFloat(tick.open) || null,
      volumeTraded: Number(tick.volumeTraded) || 0,
      lastUpdated: Date.now(),
    };

    // Validate high/low bounds
    if (normalized.high && normalized.low && normalized.high < normalized.low) {
      console.warn(`[PSX] High < Low for ${symbol}, swapping`);
      [normalized.high, normalized.low] = [normalized.low, normalized.high];
    }

    return normalized;
  }

  /**
   * Apply "latest tick wins" logic
   * Prevents race conditions and stale data
   */
  applyLatestTickWins(symbol, newTick) {
    const existing = this.tickBuffer.get(symbol);

    if (!existing) {
      this.tickBuffer.set(symbol, newTick);
      return newTick;
    }

    // Compare by sequence ID first, then timestamp
    const newSeq = newTick.sequenceId || newTick.timestamp;
    const existingSeq = existing.sequenceId || existing.timestamp;

    if (newSeq > existingSeq) {
      this.tickBuffer.set(symbol, newTick);
      return newTick;
    }

    return existing;
  }

  /**
   * Connect to PSX WebSocket (when available)
   */
  async connectWebSocket() {
    if (!this.config.wsUrl || !this.config.useWebSocket) {
      console.log("[PSX] WebSocket URL not configured, skipping");
      return false;
    }

    return new Promise((resolve) => {
      try {
        const WebSocket = require("ws");
        console.log(`[PSX] Connecting to WebSocket: ${this.config.wsUrl}`);

        this.ws = new WebSocket(this.config.wsUrl);

        this.ws.on("open", () => {
          console.log("[PSX] WebSocket connected (live market feed)");
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit("connected");
          resolve(true);
        });

        this.ws.on("message", (data) => {
          try {
            const message = JSON.parse(data);
            this.handleTick(message);
          } catch (err) {
            console.error("[PSX] Invalid WebSocket message:", err.message);
          }
        });

        this.ws.on("close", () => {
          console.log("[PSX] WebSocket disconnected");
          this.isConnected = false;
          this.emit("disconnected");

          if (this.config.fallbackToPolling) {
            this.validateAndReconnect();
          }
        });

        this.ws.on("error", (err) => {
          console.error("[PSX] WebSocket error:", err.message);
          this.isConnected = false;
          this.emit("error", err);
        });
      } catch (err) {
        console.error("[PSX] Failed to connect WebSocket:", err.message);
        resolve(false);
      }
    });
  }

  /**
   * Reconnect with exponential backoff
   */
  validateAndReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error("[PSX] Max reconnection attempts reached, falling back to polling");
      this.startPolling();
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[PSX] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connectWebSocket().then((success) => {
        if (!success) {
          this.validateAndReconnect();
        }
      });
    }, delay);
  }

  /**
   * Polling fallback (1-2 sec intervals for institutional accuracy)
   */
  startPolling() {
    if (this.pollingActive || !this.config.apiUrl) return;

    this.pollingActive = true;
    console.log(`[PSX] Starting polling fallback (interval: ${this.config.pollInterval}ms)`);

    const poll = async () => {
      try {
        const response = await fetch(this.config.apiUrl, {
          timeout: this.config.pollInterval * 0.8, // Give time for response
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (Array.isArray(data.ticks)) {
          data.ticks.forEach((tick) => this.handleTick(tick));
        } else if (data.symbol && data.price) {
          this.handleTick(data);
        }
      } catch (err) {
        console.error("[PSX] Polling error:", err.message);
      }

      if (this.pollingActive) {
        this.pollTimer = setTimeout(poll, this.config.pollInterval);
      }
    };

    poll();
  }

  /**
   * Stop polling
   */
  stopPolling() {
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Handle incoming tick - core data pipeline
   */
  handleTick(rawTick) {
    // Validate and normalize
    const tick = this.validateTick(rawTick);
    if (!tick) return;

    // Apply "latest tick wins" logic
    const finalTick = this.applyLatestTickWins(tick.symbol, tick);

    // Emit for state management
    this.emit("tick", {
      symbol: tick.symbol,
      data: finalTick,
      source: "psx",
      timestamp: Date.now(),
    });
  }

  /**
   * Get all buffered ticks (snapshot)
   */
  getSnapshot() {
    const snapshot = {};
    this.tickBuffer.forEach((tick, symbol) => {
      snapshot[symbol] = tick;
    });
    return snapshot;
  }

  /**
   * Init data source - tries WebSocket first, falls back to polling
   */
  async initialize() {
    console.log("[PSX] Initializing data source...");

    if (this.config.useWebSocket) {
      const wsSuccess = await this.connectWebSocket();
      if (wsSuccess) return;
    }

    if (this.config.fallbackToPolling) {
      this.startPolling();
      return;
    }

    throw new Error("PSX data source initialization failed: no transport available");
  }

  /**
   * Close and cleanup
   */
  shutdown() {
    console.log("[PSX] Shutting down data source");

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopPolling();
    this.isConnected = false;
    this.removeAllListeners();
  }
}

module.exports = { PSXDataSource };
