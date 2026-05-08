'use strict';

/**
 * Parse a numeric string that may contain commas, whitespace, or % signs.
 * Returns null if unparseable or non-finite.
 */
function parseNum(value, allowNegative = true) {
  if (value === undefined || value === null || value === '' || value === '--' || value === '-') return null;
  const cleaned = String(value).replace(/,/g, '').replace(/%/g, '').trim();
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return null;
  return n;
}

/**
 * Parse integer with comma stripping.
 */
function parseInt2(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalise a stock symbol: uppercase, no whitespace.
 */
function normSym(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

/**
 * Round to decimal places.
 */
function round(n, dp = 2) {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 10 ** dp) / 10 ** dp;
}

/**
 * Format volume as human-readable string.
 */
function fmtVolume(v) {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

/**
 * Validate that a price is a positive finite number.
 */
function isValidPrice(p) {
  return Number.isFinite(p) && p > 0;
}

module.exports = { parseNum, parseInt2, normSym, round, fmtVolume, isValidPrice };
