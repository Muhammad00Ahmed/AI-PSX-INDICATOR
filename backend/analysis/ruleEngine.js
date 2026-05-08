/**
 * Rule-Based Analysis Engine
 * Classifies stocks using price, volume, momentum, and volatility rules
 */

// Volume thresholds (relative)
const HIGH_VOLUME_MULTIPLIER = 1.5;
const LOW_VOLUME_MULTIPLIER = 0.7;
const MOMENTUM_THRESHOLD = 1.5; // % change
const STRONG_MOMENTUM = 3.0;
const VOLATILITY_THRESHOLD = 2.5;

// In-memory rolling volume averages (simulated)
const volumeHistory = {};

function updateVolumeHistory(symbol, volume) {
  if (!volumeHistory[symbol]) {
    volumeHistory[symbol] = [volume];
  } else {
    volumeHistory[symbol].push(volume);
    if (volumeHistory[symbol].length > 20) volumeHistory[symbol].shift();
  }
  return volumeHistory[symbol];
}

function getAvgVolume(symbol) {
  const hist = volumeHistory[symbol];
  if (!hist || hist.length < 2) return null;
  return hist.slice(0, -1).reduce((a, b) => a + b, 0) / (hist.length - 1);
}

function classifyMomentum(change) {
  const abs = Math.abs(change);
  if (abs >= STRONG_MOMENTUM) return change > 0 ? "strong_bullish" : "strong_bearish";
  if (abs >= MOMENTUM_THRESHOLD) return change > 0 ? "bullish" : "bearish";
  return "neutral";
}

function classifyVolume(symbol, currentVolume) {
  const avg = getAvgVolume(symbol);
  if (!avg) return "normal";
  const ratio = currentVolume / avg;
  if (ratio >= HIGH_VOLUME_MULTIPLIER) return "high";
  if (ratio <= LOW_VOLUME_MULTIPLIER) return "low";
  return "normal";
}

function classifySignal(priceChange, volumeClass) {
  const priceUp = priceChange > 0.2;
  const priceDown = priceChange < -0.2;
  const volHigh = volumeClass === "high";
  const volLow = volumeClass === "low";

  if (priceUp && volHigh) return { signal: "STRONG_MOMENTUM", color: "green", label: "Strong Momentum", risk: "low" };
  if (priceUp && volLow) return { signal: "WEAK_RALLY", color: "yellow", label: "Weak Rally", risk: "medium" };
  if (priceDown && volHigh) return { signal: "SELLING_PRESSURE", color: "red", label: "Selling Pressure", risk: "high" };
  if (priceDown && volLow) return { signal: "DISTRIBUTION", color: "orange", label: "Distribution", risk: "medium" };
  return { signal: "NEUTRAL", color: "gray", label: "Neutral", risk: "low" };
}

function calcVolatility(stock) {
  const range = stock.high - stock.low;
  const mid = (stock.high + stock.low) / 2 || stock.price;
  return parseFloat(((range / mid) * 100).toFixed(2));
}

function analyzeStock(stock) {
  const { symbol, price, change, volume } = stock;

  updateVolumeHistory(symbol, volume);

  const momentum = classifyMomentum(change);
  const volumeClass = classifyVolume(symbol, volume);
  const { signal, color, label, risk } = classifySignal(change, volumeClass);
  const volatility = calcVolatility(stock);
  const isVolatile = volatility > VOLATILITY_THRESHOLD;

  // Override risk if highly volatile
  const finalRisk = isVolatile && risk !== "high" ? "medium" : risk;

  const avgVol = getAvgVolume(symbol);
  const volumeRatio = avgVol ? parseFloat((volume / avgVol).toFixed(2)) : 1.0;

  return {
    momentum,
    volumeClass,
    volumeRatio,
    signal,
    signalColor: color,
    signalLabel: label,
    risk: finalRisk,
    volatility,
    isVolatile,
    analysisNotes: generateNotes(momentum, volumeClass, volatility, change),
  };
}

function generateNotes(momentum, volumeClass, volatility, change) {
  const notes = [];
  if (momentum === "strong_bullish") notes.push("Strong upward price momentum detected");
  if (momentum === "strong_bearish") notes.push("Significant downward pressure observed");
  if (volumeClass === "high") notes.push("Above-average trading volume suggests conviction");
  if (volumeClass === "low") notes.push("Below-average volume may indicate weak conviction");
  if (volatility > 3) notes.push("Elevated intraday volatility detected");
  if (Math.abs(change) < 0.1) notes.push("Price movement within typical noise range");
  return notes;
}

module.exports = { analyzeStock };
