/**
 * PSX Market Data Repository
 * 
 * Central orchestrator for real-time market data with institutional-grade accuracy.
 * - Single source of truth for all stock data
 * - Tick-by-tick synchronization
 * - Atomic updates with version control
 * - Built-in validation and consistency checks
 */

const { PSXDataSource } = require("./psxDataSource");
const { MarketState } = require("./marketState");

class PSXMarketRepository {
  constructor(config = {}) {
    this.config = config;
    this.state = new MarketState();
    this.dataSource = null;
    this.listeners = new Set();
    this.healthCheck = null;
    this.lastValidationTime = 0;
    this.validationInterval = config.validationInterval || 30000; // 30s
  }

  /**
   * Initialize the repository
   */
  async initialize() {
    console.log("[REPO] Initializing PSX market repository...");

    // Setup data source
    this.dataSource = new PSXDataSource({
      wsUrl: process.env.PSX_WS_URL,
      apiUrl: process.env.PSX_API_URL,
      pollInterval: 1500, // 1.5s for institutional accuracy
      useWebSocket: true,
      fallbackToPolling: true,
    });

    // Listen to ticks from data source
    this.dataSource.on("tick", async (tickEvent) => {
      await this.processTick(tickEvent);
    });

    this.dataSource.on("connected", () => {
      console.log("[REPO] PSX data source connected");
      this.broadcastEvent("connected");
    });

    this.dataSource.on("disconnected", () => {
      console.log("[REPO] PSX data source disconnected");
      this.broadcastEvent("disconnected");
    });

    // Initialize data source
    await this.dataSource.initialize();

    // Start health checks
    this.startHealthChecks();

    console.log("[REPO] PSX market repository ready");
  }

  /**
   * Process incoming tick
   */
  async processTick(tickEvent) {
    const { symbol, data } = tickEvent;

    // Validate before updating state
    if (!this.validateTick(data)) {
      console.warn(`[REPO] Validation failed for tick: ${symbol}`);
      return;
    }

    // Update state atomically
    const updated = await this.state.updateStock(symbol, data);

    if (updated) {
      // Broadcast to all subscribers
      this.broadcastEvent("stock_update", {
        symbol,
        data,
        version: this.state.version,
      });
    }
  }

  /**
   * Validate tick before state update
   */
  validateTick(tick) {
    if (!tick || typeof tick !== "object") return false;

    if (!String(tick.symbol).trim()) return false;
    if (!Number.isFinite(tick.price) || tick.price <= 0) return false;
    if (!Number.isFinite(tick.timestamp) || tick.timestamp <= 0) return false;

    return true;
  }

  /**
   * Get stock by symbol
   */
  getStock(symbol) {
    return this.state.getStock(symbol);
  }

  /**
   * Get all stocks
   */
  getAllStocks() {
    return this.state.getAllStocks();
  }

  /**
   * Get index
   */
  getIndex(indexName) {
    return this.state.getIndex(indexName);
  }

  /**
   * Get all indices
   */
  getAllIndices() {
    return this.state.getAllIndices();
  }

  /**
   * Get full market state
   */
  getMarketState() {
    return this.state.getSnapshot();
  }

  /**
   * Get market statistics
   */
  getMarketStats() {
    return this.state.getStats();
  }

  /**
   * Subscribe to market events
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Broadcast event to all subscribers
   */
  broadcastEvent(eventType, data = {}) {
    const event = {
      type: eventType,
      data,
      timestamp: Date.now(),
      version: this.state.version,
    };

    this.listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (err) {
        console.error("[REPO] Error in listener:", err.message);
      }
    });
  }

  /**
   * Start health checks to ensure consistency
   */
  startHealthChecks() {
    this.healthCheck = setInterval(() => {
      const errors = this.state.validateConsistency();

      if (errors) {
        console.error("[REPO] Consistency check failed:", errors);
        this.broadcastEvent("consistency_error", { errors });
      }

      this.lastValidationTime = Date.now();
    }, this.validationInterval);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks() {
    if (this.healthCheck) {
      clearInterval(this.healthCheck);
      this.healthCheck = null;
    }
  }

  /**
   * Get repository health status
   */
  getHealth() {
    const errors = this.state.validateConsistency();
    const stats = this.state.getStats();

    return {
      status: errors ? "unhealthy" : "healthy",
      errors,
      stats,
      version: this.state.version,
      lastValidation: this.lastValidationTime,
      dataSourceConnected: this.dataSource?.isConnected || false,
      webSocketActive: this.dataSource?.ws ? this.dataSource.ws.readyState === 1 : false,
      pollingActive: this.dataSource?.pollingActive || false,
    };
  }

  /**
   * Shutdown repository
   */
  shutdown() {
    console.log("[REPO] Shutting down PSX market repository");

    this.stopHealthChecks();

    if (this.dataSource) {
      this.dataSource.shutdown();
    }

    this.listeners.clear();
    this.state.reset();
  }
}

// Global instance
let globalRepository = null;

function getRepository(config) {
  if (!globalRepository) {
    globalRepository = new PSXMarketRepository(config);
  }
  return globalRepository;
}

function resetRepository() {
  if (globalRepository) {
    globalRepository.shutdown();
    globalRepository = null;
  }
}

module.exports = { PSXMarketRepository, getRepository, resetRepository };
