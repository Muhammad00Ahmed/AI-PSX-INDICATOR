'use strict';

/**
 * PSX Market Session Utilities
 * Trading hours: Mon-Fri, 09:30–15:30 PKT (UTC+5)
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5

function nowPKT() {
  return new Date(Date.now() + PKT_OFFSET_MS);
}

/**
 * Returns 'PRE_MARKET' | 'OPEN' | 'CLOSED' | 'WEEKEND'
 */
function getMarketStatus() {
  const now = nowPKT();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  if (day === 0 || day === 6) return 'WEEKEND';

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMin = h * 60 + m;

  const openMin = 9 * 60 + 30;   // 09:30
  const closeMin = 15 * 60 + 30; // 15:30

  if (totalMin < openMin) return 'PRE_MARKET';
  if (totalMin >= closeMin) return 'CLOSED';
  return 'OPEN';
}

function isMarketOpen() {
  return getMarketStatus() === 'OPEN';
}

function minutesToOpen() {
  const status = getMarketStatus();
  if (status === 'OPEN') return 0;
  const now = nowPKT();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMin = h * 60 + m;
  const openMin = 9 * 60 + 30;
  return openMin > totalMin ? openMin - totalMin : (24 * 60 - totalMin + openMin);
}

/**
 * Get polling interval appropriate for market state.
 * More aggressive during market hours, relaxed otherwise.
 */
function getAdaptivePollInterval() {
  const status = getMarketStatus();
  switch (status) {
    case 'OPEN':       return 2000;  // 2s during trading
    case 'PRE_MARKET': return 5000;  // 5s pre-market
    case 'CLOSED':     return 30000; // 30s after close
    case 'WEEKEND':    return 60000; // 1m weekends
    default:           return 5000;
  }
}

module.exports = { getMarketStatus, isMarketOpen, minutesToOpen, getAdaptivePollInterval, nowPKT };
