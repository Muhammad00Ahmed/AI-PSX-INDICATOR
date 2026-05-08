/**
 * Data Normalization and Validation Utilities
 * Ensures all stock data is properly typed and validated before storage
 */

function parseNumber(value, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const cleaned = String(value).replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseInteger(value, defaultValue = 0) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const cleaned = String(value).replace(/,/g, "").trim();
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseString(value, defaultValue = "") {
  if (value === undefined || value === null) return defaultValue;
  return String(value).trim();
}

function normalizeStockSymbol(symbol) {
  return parseString(symbol).toUpperCase();
}

function validateAndNormalizeStock(rawStock) {
  if (!rawStock || typeof rawStock !== "object") return null;

  const symbol = normalizeStockSymbol(rawStock.symbol || rawStock.symbolCode || rawStock.symbolName);
  if (!symbol) return null;

  // Validate required numeric fields
  const price = parseNumber(rawStock.price ?? rawStock.current ?? rawStock.close ?? rawStock.lastTradedPrice);
  if (price === null || price <= 0) return null;

  const normalized = {
    symbol,
    name: parseString(rawStock.name || rawStock.companyName || rawStock.title || symbol),
    sectorCode: parseString(rawStock.sectorCode || rawStock.sector || ""),
    sectorName: parseString(rawStock.sectorName || rawStock.sector || ""),
    listedIn: Array.isArray(rawStock.listedIn) ? rawStock.listedIn.map(parseString).filter(Boolean) : [],
    listed: Array.isArray(rawStock.listed) ? rawStock.listed.map(parseString).filter(Boolean) : [],
    isDebt: Boolean(rawStock.isDebt),
    isETF: Boolean(rawStock.isETF),
    isGEM: Boolean(rawStock.isGEM),
    ldcp: parseNumber(rawStock.ldcp ?? rawStock.lastClose ?? rawStock.prevClose, price),
    open: parseNumber(rawStock.open, null),
    high: parseNumber(rawStock.high, null),
    low: parseNumber(rawStock.low, null),
    price,
    change: parseNumber(rawStock.change ?? rawStock.priceChange ?? rawStock.diff, 0),
    changePercent: parseNumber(rawStock.changePercent ?? rawStock.change_pct ?? rawStock.percentChange, 0),
    volume: parseInteger(rawStock.volume ?? rawStock.volumeTraded ?? rawStock.v, 0),
    prevPrice: parseNumber(rawStock.prevPrice, null),
    // Analysis fields will be added later
    signal: parseString(rawStock.signal) || null,
    risk: parseString(rawStock.risk) || null,
    score: null, // Will be set by analysis
    kse100: rawStock.kse100 ? validateAndNormalizeIndex(rawStock.kse100) : null,
    kse30: rawStock.kse30 ? validateAndNormalizeIndex(rawStock.kse30) : null,
    lastUpdated: Date.now(),
  };

  // Validate derived fields
  if (normalized.prevPrice === null && normalized.change !== 0) {
    normalized.prevPrice = parseFloat((normalized.price - normalized.change).toFixed(2));
  }

  // Ensure high/low bounds
  if (normalized.high !== null && normalized.low !== null) {
    if (normalized.high < normalized.low) {
      [normalized.high, normalized.low] = [normalized.low, normalized.high];
    }
  }

  return normalized;
}

function validateAndNormalizeIndex(rawIndex) {
  if (!rawIndex || typeof rawIndex !== "object") return null;

  const value = parseNumber(rawIndex.value);
  if (value === null || value <= 0) return null;

  return {
    value,
    change: parseNumber(rawIndex.change, 0),
    changePercent: parseNumber(rawIndex.changePercent, 0),
    volume: parseInteger(rawIndex.volume, 0),
    lastUpdated: parseNumber(rawIndex.lastUpdated) || Date.now(),
  };
}

function validateAndNormalizeCurrency(rawCurrency) {
  if (!rawCurrency || typeof rawCurrency !== "object") return null;

  const rate = parseNumber(rawCurrency.rate);
  if (rate === null || rate <= 0) return null;

  return {
    rate,
    direction: parseString(rawCurrency.direction) || null,
    source: parseString(rawCurrency.source) || null,
    open: parseNumber(rawCurrency.open, null),
    high: parseNumber(rawCurrency.high, null),
    low: parseNumber(rawCurrency.low, null),
    change: parseNumber(rawCurrency.change, 0),
    lastUpdated: Date.now(),
  };
}

function validateAndNormalizeNews(rawNews) {
  if (!Array.isArray(rawNews)) return [];

  return rawNews
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const title = parseString(item.title);
      if (!title) return null;

      return {
        id: parseString(item.id || item.url || item.title),
        title,
        summary: parseString(item.summary),
        source: parseString(item.source),
        url: parseString(item.url),
        publishedAt: parseString(item.publishedAt),
        sentiment: parseString(item.sentiment) || "neutral",
        relatedStocks: Array.isArray(item.relatedStocks) ? item.relatedStocks.map(normalizeStockSymbol).filter(Boolean) : [],
        lastUpdated: Date.now(),
      };
    })
    .filter(Boolean);
}

function validateAndNormalizeInsight(rawInsight) {
  if (!rawInsight || typeof rawInsight !== "object") return null;

  return {
    ...rawInsight,
    generatedAt: Date.now(),
    dataPoints: rawInsight.dataPoints || null,
    sections: rawInsight.sections || null,
    disclaimer: parseString(rawInsight.disclaimer) || null,
  };
}

module.exports = {
  parseNumber,
  parseInteger,
  parseString,
  normalizeStockSymbol,
  validateAndNormalizeStock,
  validateAndNormalizeIndex,
  validateAndNormalizeCurrency,
  validateAndNormalizeNews,
  validateAndNormalizeInsight,
};