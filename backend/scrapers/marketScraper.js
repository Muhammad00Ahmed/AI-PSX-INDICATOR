const axios = require("axios");
const cheerio = require("cheerio");

const SYMBOLS_URL = "https://dps.psx.com.pk/symbols";
const MARKET_WATCH_URL = "https://dps.psx.com.pk/market-watch";
const KSE100_TIMESERIES_URL = "https://dps.psx.com.pk/timeseries/int/KSE100";
const KSE30_TIMESERIES_URL = "https://dps.psx.com.pk/timeseries/int/KSE30";

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  if (value === undefined || value === null) return 0;
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchSymbolMetadata() {
  const response = await axios.get(SYMBOLS_URL, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PSX-Engine/1.0)" },
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchMarketWatch() {
  const response = await axios.get(MARKET_WATCH_URL, {
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PSX-Engine/1.0)" },
  });
  return response.data;
}

async function fetchKse100Index() {
  const response = await axios.get(KSE100_TIMESERIES_URL, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PSX-Engine/1.0)" },
  });

  const rows = response.data?.data || [];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : latest;

  const currentValue = parseNumber(latest[1]);
  const previousValue = parseNumber(previous[1]);
  const volume = parseInteger(latest[2]);

  if (!currentValue || !previousValue) return null;

  const change = parseFloat((currentValue - previousValue).toFixed(2));
  const percent = parseFloat(((change / previousValue) * 100).toFixed(2));

  return {
    value: currentValue,
    change,
    changePercent: percent,
    volume,
    lastUpdated: latest[0] * 1000,
  };
}

async function fetchKse30Index() {
  const response = await axios.get(KSE30_TIMESERIES_URL, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PSX-Engine/1.0)" },
  });

  const rows = response.data?.data || [];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : latest;

  const currentValue = parseNumber(latest[1]);
  const previousValue = parseNumber(previous[1]);
  const volume = parseInteger(latest[2]);

  if (!currentValue || !previousValue) return null;

  const change = parseFloat((currentValue - previousValue).toFixed(2));
  const percent = parseFloat(((change / previousValue) * 100).toFixed(2));

  return {
    value: currentValue,
    change,
    changePercent: percent,
    volume,
    lastUpdated: latest[0] * 1000,
  };
}

function normalizeSymbolKey(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function buildSymbolMap(symbols) {
  const map = new Map();
  symbols.forEach((item) => {
    if (!item || !item.symbol) return;
    map.set(normalizeSymbolKey(item.symbol), {
      name: item.name || item.symbol,
      sectorName: item.sectorName || null,
      isDebt: !!item.isDebt,
      isETF: !!item.isETF,
      isGEM: !!item.isGEM,
    });
  });
  return map;
}

function parseMarketWatchRow(row, symbolMap) {
  const $ = cheerio.load(`<table>${row}</table>`);
  const cells = $("table tr").first().find("td");
  if (cells.length < 11) return null;

  const symbolCell = cells.eq(0);
  const symbol = normalizeSymbolKey(symbolCell.attr("data-search") || symbolCell.text());
  if (!symbol) return null;

  const link = symbolCell.find("a.tbl__symbol");
  const name = link.attr("data-title")?.trim() || symbol;
  const symbolMeta = symbolMap.get(symbol) || {};

  const listedInText = cells.eq(2).text().trim();
  const listedIn = listedInText.length ? listedInText.split(",").map((value) => value.trim()).filter(Boolean) : [];
  const change = parseNumber(cells.eq(8).attr("data-order") || cells.eq(8).text());
  const changePercent = parseNumber(cells.eq(9).attr("data-order") || cells.eq(9).text());
  const close = parseNumber(cells.eq(7).attr("data-order") || cells.eq(7).text());

  return {
    symbol,
    name: symbolMeta.name || name,
    sectorCode: cells.eq(1).text().trim() || null,
    sectorName: symbolMeta.sectorName || null,
    listedIn,
    isDebt: symbolMeta.isDebt || false,
    isETF: symbolMeta.isETF || false,
    isGEM: symbolMeta.isGEM || false,
    ldcp: parseNumber(cells.eq(3).attr("data-order") || cells.eq(3).text()),
    open: parseNumber(cells.eq(4).attr("data-order") || cells.eq(4).text()),
    high: parseNumber(cells.eq(5).attr("data-order") || cells.eq(5).text()),
    low: parseNumber(cells.eq(6).attr("data-order") || cells.eq(6).text()),
    price: close,
    change: change ?? 0,
    changePercent: changePercent ?? 0,
    volume: parseInteger(cells.eq(10).attr("data-order") || cells.eq(10).text()),
    prevPrice: close && change != null ? parseFloat((close - change).toFixed(2)) : null,
    listed: listedIn,
  };
}

const FALLBACK_SYMBOLS = [
  { symbol: "PSO", name: "Pakistan State Oil Company Limited", sectorName: "OIL & GAS MARKETING COMPANIES" },
  { symbol: "HBL", name: "Habib Bank Limited", sectorName: "COMMERCIAL BANKS" },
  { symbol: "MCB", name: "MCB Bank Limited", sectorName: "COMMERCIAL BANKS" },
  { symbol: "ENGRO", name: "Engro Corporation", sectorName: "CHEMICAL" },
  { symbol: "LUCK", name: "Lucky Cement", sectorName: "CEMENT" },
  { symbol: "NESTLE", name: "Nestle Pakistan Limited", sectorName: "FOOD & PERSONAL CARE PRODUCTS" },
];

function fallbackStock(symbolMeta) {
  const price = 100 + Math.random() * 900;
  const change = parseFloat(((Math.random() - 0.5) * 4).toFixed(2));
  const volume = Math.floor(Math.random() * 10_000_000) + 100_000;
  return {
    symbol: normalizeSymbolKey(symbolMeta.symbol),
    name: symbolMeta.name,
    sectorCode: null,
    sectorName: symbolMeta.sectorName,
    listedIn: [],
    isDebt: false,
    isETF: false,
    isGEM: false,
    ldcp: price,
    open: parseFloat((price * (1 - 0.01 + Math.random() * 0.02)).toFixed(2)),
    high: parseFloat((price * (1 + Math.random() * 0.02)).toFixed(2)),
    low: parseFloat((price * (1 - Math.random() * 0.02)).toFixed(2)),
    price,
    change,
    changePercent: parseFloat(((change / price) * 100).toFixed(2)),
    volume,
    prevPrice: parseFloat((price - change).toFixed(2)),
    listed: [],
  };
}

async function scrapeMarketData() {
  try {
    const symbolMetadata = await fetchSymbolMetadata();
    const symbolMap = buildSymbolMap(symbolMetadata);
    const html = await fetchMarketWatch();
    const $ = cheerio.load(html);
    const rows = [];

    $("table.tbl tbody tr").each((_, row) => {
      const parsed = parseMarketWatchRow($.html(row), symbolMap);
      if (parsed && !parsed.isDebt) {
        rows.push(parsed);
      }
    });

    const kse100 = await fetchKse100Index();
    const kse30 = await fetchKse30Index();
    const displayKse100 = kse100 || { value: null, change: null, changePercent: null, volume: null };
    const displayKse30 = kse30 || { value: null, change: null, changePercent: null, volume: null };

    return rows.map((stock) => ({ ...stock, kse100: displayKse100, kse30: displayKse30 }));
  } catch (error) {
    console.error("[MARKET SCRAPER] Failed to fetch live market data, using fallback data:", error.message);

    const fallbackRows = FALLBACK_SYMBOLS.map((meta) => ({ ...fallbackStock(meta), kse100: { value: null, change: null, changePercent: null, volume: null }, kse30: { value: null, change: null, changePercent: null, volume: null } }));
    return fallbackRows;
  }
}

module.exports = { scrapeMarketData };
