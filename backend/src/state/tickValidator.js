'use strict';

const { parseNum, parseInt2, normSym, round, isValidPrice } = require('../utils/numbers');
const logger = require('../utils/logger');

/**
 * Normalised tick schema — every field guaranteed present or null.
 * This is the ONLY data contract used throughout the system.
 */
const TICK_SCHEMA = Object.freeze({
  symbol: '',
  companyName: '',
  sector: null,
  sectorCode: null,
  price: null,
  change: 0,
  changePercent: 0,
  open: null,
  high: null,
  low: null,
  ldcp: null,          // Last Day Closing Price (previous close)
  volume: 0,
  marketStatus: 'UNKNOWN',
  timestamp: 0,
  sequenceId: 0,
  source: 'unknown',
  latency: 0,
  listedIn: [],
  isDebt: false,
  isETF: false,
  isGEM: false,
});

/**
 * Validate and normalise a raw data object into a strict tick.
 * Returns null if the tick is invalid and should be rejected.
 */
function validateTick(raw, source = 'unknown') {
  if (!raw || typeof raw !== 'object') {
    logger.warn({ source }, 'Tick validation: non-object input');
    return null;
  }

  const symbol = normSym(raw.symbol || raw.symbolCode || raw.ticker || '');
  if (!symbol) {
    logger.warn({ raw }, 'Tick validation: missing symbol');
    return null;
  }

  // ── Price ───────────────────────────────────────────────────────────
  const price = parseNum(raw.price ?? raw.current ?? raw.close ?? raw.lastTradedPrice ?? raw.ltp);
  if (!isValidPrice(price)) {
    logger.debug({ symbol, raw_price: raw.price }, 'Tick validation: invalid price, skipping');
    return null;
  }

  // ── Timestamp ──────────────────────────────────────────────────────
  const now = Date.now();
  let ts = Number(raw.timestamp ?? raw.ts ?? raw.time ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) ts = now;
  // Reject ticks more than 5 minutes in the future
  if (ts > now + 5 * 60 * 1000) {
    logger.warn({ symbol, ts }, 'Tick validation: future timestamp rejected');
    return null;
  }

  // ── Change values ──────────────────────────────────────────────────
  const change = round(parseNum(raw.change ?? raw.priceChange ?? raw.diff ?? 0) ?? 0);
  const ldcp = parseNum(raw.ldcp ?? raw.prevClose ?? raw.previousClose ?? raw.lastClose);

  // Recompute changePercent from ldcp if available and more accurate
  let changePercent;
  if (ldcp && isValidPrice(ldcp)) {
    changePercent = round((change / ldcp) * 100);
  } else {
    changePercent = round(parseNum(raw.changePercent ?? raw.change_pct ?? raw.pctChange ?? 0) ?? 0);
  }

  // ── OHLCV ──────────────────────────────────────────────────────────
  const open   = parseNum(raw.open);
  let high     = parseNum(raw.high);
  let low      = parseNum(raw.low);
  const volume = parseInt2(raw.volume ?? raw.volumeTraded ?? raw.v ?? 0);

  // Sanity: high must be >= low
  if (high !== null && low !== null && high < low) {
    [high, low] = [low, high];
    logger.debug({ symbol }, 'Tick validation: swapped high/low');
  }

  // Sanity: price should be within high/low range (allow 5% drift from sources)
  if (high !== null && price > high * 1.05) {
    logger.debug({ symbol, price, high }, 'Tick: price exceeds high — clamping high');
    high = price;
  }
  if (low !== null && low > 0 && price < low * 0.95) {
    logger.debug({ symbol, price, low }, 'Tick: price below low — clamping low');
    low = price;
  }

  // ── Sequence ID ────────────────────────────────────────────────────
  const sequenceId = Number(raw.sequenceId ?? raw.seq ?? ts);

  const tick = {
    ...TICK_SCHEMA,
    symbol,
    companyName: String(raw.companyName ?? raw.name ?? raw.title ?? symbol).trim(),
    sector:      String(raw.sector ?? raw.sectorName ?? '').trim() || null,
    sectorCode:  String(raw.sectorCode ?? '').trim() || null,
    price,
    change,
    changePercent,
    open,
    high,
    low,
    ldcp,
    volume,
    marketStatus: String(raw.marketStatus ?? 'UNKNOWN'),
    timestamp: ts,
    sequenceId,
    source,
    latency: now - ts,
    listedIn: Array.isArray(raw.listedIn) ? raw.listedIn.map(String) : [],
    isDebt: Boolean(raw.isDebt),
    isETF: Boolean(raw.isETF),
    isGEM: Boolean(raw.isGEM),
  };

  return tick;
}

/**
 * Validate an index tick (KSE-100, KSE-30, etc.)
 */
function validateIndexTick(raw, indexName, source = 'unknown') {
  if (!raw || typeof raw !== 'object') return null;

  const value = parseNum(raw.value ?? raw.close ?? raw.current ?? raw.index);
  if (!isValidPrice(value)) return null;

  const ts = Number(raw.timestamp ?? raw.lastUpdated ?? Date.now());
  const change = round(parseNum(raw.change ?? 0) ?? 0);
  const ldcp = parseNum(raw.previousClose ?? raw.prevClose ?? raw.ldcp);

  let changePercent;
  if (ldcp && isValidPrice(ldcp)) {
    changePercent = round((change / ldcp) * 100);
  } else {
    changePercent = round(parseNum(raw.changePercent ?? 0) ?? 0);
  }

  return {
    name: normSym(indexName),
    value: round(value),
    change,
    changePercent,
    volume: parseInt2(raw.volume ?? 0),
    high: parseNum(raw.high) ?? null,
    low: parseNum(raw.low) ?? null,
    open: parseNum(raw.open) ?? null,
    timestamp: ts,
    sequenceId: Number(raw.sequenceId ?? ts),
    source,
    latency: Date.now() - ts,
  };
}

module.exports = { validateTick, validateIndexTick, TICK_SCHEMA };
