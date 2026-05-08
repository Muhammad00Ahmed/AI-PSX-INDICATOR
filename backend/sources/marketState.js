/**
 * Real-Time Market State Management
 * 
 * Single global state for all stocks with tick-by-tick synchronization.
 * Ensures no duplicate updates, no race conditions, perfect consistency.
 */

class MarketState {
  constructor() {
    // Stocks indexed by symbol for O(1) lookup
    this.stocks = new Map();
    // Indices (KSE-100, KSE-30)
    this.indices = new Map();
    // Version counter for serialization
    this.version = 0;
    // Last update timestamp
    this.lastUpdateTime = 0;
    // Pending updates queue for batch processing
    this.pendingUpdates = [];
    // Update lock to prevent race conditions
    this.updateLock = false;
  }

  /**
   * Acquire lock for atomic updates
   */
  async acquireLock() {
    while (this.updateLock) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    this.updateLock = true;
  }

  /**
   * Release lock after updates
   */
  releaseLock() {
    this.updateLock = false;
  }

  /**
   * Update or create a stock with latest tick
   * Implements "latest tick wins" with version tracking
   */
  async updateStock(symbol, tickData) {
    await this.acquireLock();
    try {
      const normalized = {
        symbol: String(symbol).toUpperCase(),
        price: Number(tickData.price),
        change: Number(tickData.change || 0),
        changePercent: Number(tickData.changePercent || 0),
        volume: Number(tickData.volume || 0),
        timestamp: tickData.timestamp || Date.now(),
        sequenceId: tickData.sequenceId || 0,
        high: tickData.high ? Number(tickData.high) : null,
        low: tickData.low ? Number(tickData.low) : null,
        open: tickData.open ? Number(tickData.open) : null,
        lastUpdated: Date.now(),
        // Metadata
        metadata: tickData.metadata || {},
      };

      const existing = this.stocks.get(symbol);

      // Check if new tick is newer
      if (existing) {
        const newSeq = normalized.sequenceId || normalized.timestamp;
        const existingSeq = existing.sequenceId || existing.timestamp;

        if (newSeq <= existingSeq) {
          // Reject stale tick
          return false;
        }
      }

      // Update stock and increment version
      this.stocks.set(symbol, normalized);
      this.version++;
      this.lastUpdateTime = Date.now();

      return true;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Batch update multiple stocks atomically
   */
  async updateBatch(ticksMap) {
    await this.acquireLock();
    try {
      let updateCount = 0;
      const timestamp = Date.now();

      ticksMap.forEach((tickData, symbol) => {
        const normalized = {
          symbol: String(symbol).toUpperCase(),
          price: Number(tickData.price),
          change: Number(tickData.change || 0),
          changePercent: Number(tickData.changePercent || 0),
          volume: Number(tickData.volume || 0),
          timestamp: tickData.timestamp || timestamp,
          sequenceId: tickData.sequenceId || 0,
          high: tickData.high ? Number(tickData.high) : null,
          low: tickData.low ? Number(tickData.low) : null,
          open: tickData.open ? Number(tickData.open) : null,
          lastUpdated: timestamp,
        };

        const existing = this.stocks.get(symbol);
        if (existing) {
          const newSeq = normalized.sequenceId || normalized.timestamp;
          const existingSeq = existing.sequenceId || existing.timestamp;

          if (newSeq <= existingSeq) {
            return; // Skip stale tick
          }
        }

        this.stocks.set(symbol, normalized);
        updateCount++;
      });

      if (updateCount > 0) {
        this.version++;
        this.lastUpdateTime = timestamp;
      }

      return updateCount;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Update index values (KSE-100, KSE-30)
   */
  async updateIndex(indexName, indexData) {
    await this.acquireLock();
    try {
      const normalized = {
        name: String(indexName).toUpperCase(),
        value: Number(indexData.value),
        change: Number(indexData.change || 0),
        changePercent: Number(indexData.changePercent || 0),
        timestamp: indexData.timestamp || Date.now(),
        sequenceId: indexData.sequenceId || 0,
        lastUpdated: Date.now(),
      };

      const existing = this.indices.get(indexName);
      if (existing) {
        const newSeq = normalized.sequenceId || normalized.timestamp;
        const existingSeq = existing.sequenceId || existing.timestamp;

        if (newSeq <= existingSeq) {
          return false; // Reject stale
        }
      }

      this.indices.set(indexName, normalized);
      this.version++;
      this.lastUpdateTime = Date.now();

      return true;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Get single stock
   */
  getStock(symbol) {
    return this.stocks.get(String(symbol).toUpperCase()) || null;
  }

  /**
   * Get all stocks
   */
  getAllStocks() {
    const result = [];
    this.stocks.forEach((stock) => {
      result.push(stock);
    });
    return result;
  }

  /**
   * Get index
   */
  getIndex(indexName) {
    return this.indices.get(String(indexName).toUpperCase()) || null;
  }

  /**
   * Get all indices
   */
  getAllIndices() {
    const result = [];
    this.indices.forEach((index) => {
      result.push(index);
    });
    return result;
  }

  /**
   * Get full state snapshot
   */
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

  /**
   * Get state statistics
   */
  getStats() {
    const stocks = this.getAllStocks();
    const gainers = stocks.filter((s) => s.change > 0).length;
    const losers = stocks.filter((s) => s.change < 0).length;
    const unchanged = stocks.length - gainers - losers;

    return {
      totalStocks: stocks.length,
      gainers,
      losers,
      unchanged,
      totalVolume: stocks.reduce((sum, s) => sum + (s.volume || 0), 0),
      version: this.version,
      lastUpdate: this.lastUpdateTime,
    };
  }

  /**
   * Validate consistency
   */
  validateConsistency() {
    const errors = [];

    this.stocks.forEach((stock, symbol) => {
      if (!stock.symbol || stock.symbol !== symbol) {
        errors.push(`Symbol mismatch: ${symbol} vs ${stock.symbol}`);
      }

      if (!Number.isFinite(stock.price) || stock.price <= 0) {
        errors.push(`Invalid price for ${symbol}: ${stock.price}`);
      }

      if (!Number.isFinite(stock.timestamp) || stock.timestamp <= 0) {
        errors.push(`Invalid timestamp for ${symbol}: ${stock.timestamp}`);
      }

      if (stock.high && stock.low && stock.high < stock.low) {
        errors.push(`High < Low for ${symbol}`);
      }
    });

    return errors.length === 0 ? null : errors;
  }

  /**
   * Clear all state (for testing)
   */
  reset() {
    this.stocks.clear();
    this.indices.clear();
    this.version = 0;
    this.lastUpdateTime = 0;
  }
}

module.exports = { MarketState };
