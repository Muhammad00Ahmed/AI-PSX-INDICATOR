/**
 * In-memory data store with simple file persistence for portfolio holdings.
 * In production, replace with Redis or MongoDB.
 */

const fs = require("fs");
const path = require("path");
const {
  validateAndNormalizeStock,
  validateAndNormalizeCurrency,
  validateAndNormalizeNews,
  validateAndNormalizeInsight,
} = require("./dataNormalizer");

let _stocks = [];
let _news = [];
let _currency = null;
let _insight = null;
let _holdings = [];
let _version = 0;

const portfolioFile = path.join(__dirname, "portfolio.json");

function loadHoldings() {
  try {
    if (fs.existsSync(portfolioFile)) {
      const raw = fs.readFileSync(portfolioFile, "utf8");
      return JSON.parse(raw || "[]");
    }
  } catch (err) {
    console.error("[STORE] Failed to load portfolio file:", err.message);
  }
  return [];
}

function saveHoldings() {
  try {
    fs.writeFileSync(portfolioFile, JSON.stringify(_holdings, null, 2), "utf8");
  } catch (err) {
    console.error("[STORE] Failed to save portfolio file:", err.message);
  }
}

_holdings = loadHoldings();

const dataStore = {
  setStocks(rawStocks) {
    if (!Array.isArray(rawStocks)) {
      console.warn("[STORE] Invalid stocks data provided");
      return;
    }
    const normalized = rawStocks.map(validateAndNormalizeStock).filter(Boolean);
    _stocks = normalized;
    _version++;
  },

  getStocks() { return _stocks; },

  setNews(rawNews) {
    _news = validateAndNormalizeNews(rawNews);
    _version++;
  },

  getNews() { return _news; },

  setCurrency(rawCurrency) {
    _currency = validateAndNormalizeCurrency(rawCurrency);
    _version++;
  },

  getCurrency() { return _currency; },

  setInsight(rawInsight) {
    _insight = validateAndNormalizeInsight(rawInsight);
    _version++;
  },

  getInsight() { return _insight; },

  getVersion() { return _version; },

  setHoldings(holdings) {
    _holdings = holdings;
    saveHoldings();
  },
  getHoldings() { return _holdings; },
  upsertHolding(holding) {
    const existingIndex = _holdings.findIndex((item) => item.symbol === holding.symbol);
    if (existingIndex === -1) {
      _holdings.push(holding);
    } else {
      _holdings[existingIndex] = { ..._holdings[existingIndex], ...holding };
    }
    saveHoldings();
  },
  removeHolding(symbol) {
    _holdings = _holdings.filter((item) => item.symbol !== symbol);
    saveHoldings();
  },

  getAll() {
    return {
      stocks: _stocks,
      news: _news,
      currency: _currency,
      insight: _insight,
      holdings: _holdings,
      lastUpdated: Date.now(),
      version: _version,
    };
  },
};

module.exports = { dataStore };
