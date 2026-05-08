/**
 * Weighted Scoring Engine
 * S = 0.35M + 0.25V + 0.25N + 0.15C
 * Output: -1.0 to +1.0
 */

function momentumScore(change) {
  // Normalize to -1..+1 using tanh (caps extreme values)
  return Math.tanh(change / 3);
}

function volumeScore(volumeRatio) {
  if (!volumeRatio) return 0;
  // High volume = positive signal (1.5x = 0.5 score)
  return Math.tanh((volumeRatio - 1) * 1.5);
}

function newsScore(news, symbol) {
  const related = news.filter(
    (n) => n.relatedStocks && n.relatedStocks.includes(symbol)
  );

  // Also use general market sentiment
  const general = news.slice(0, 5);
  const allRelevant = related.length > 0 ? related : general;

  if (!allRelevant.length) return 0;

  const sentimentMap = { positive: 1, neutral: 0, negative: -1 };
  const avg =
    allRelevant.reduce((sum, n) => sum + (sentimentMap[n.sentiment] || 0), 0) /
    allRelevant.length;

  return parseFloat(avg.toFixed(3));
}

function currencyScore(currency) {
  if (!currency) return 0;
  // PKR depreciation is generally negative for most stocks (import costs)
  // Exporters (tech) benefit slightly
  const { direction, changePct } = currency;
  if (direction === "depreciation") return Math.max(-0.3, -Math.abs(changePct) * 5);
  if (direction === "appreciation") return Math.min(0.2, Math.abs(changePct) * 5);
  return 0;
}

function scoringEngine(stock, news, currency) {
  const M = momentumScore(stock.change || 0);
  const V = volumeScore(stock.volumeRatio || 1);
  const N = newsScore(news || [], stock.symbol);
  const C = currencyScore(currency);

  const score = 0.35 * M + 0.25 * V + 0.25 * N + 0.15 * C;
  const clamped = Math.max(-1, Math.min(1, score));

  return {
    score: parseFloat(clamped.toFixed(3)),
    components: {
      momentum: parseFloat(M.toFixed(3)),
      volume: parseFloat(V.toFixed(3)),
      news: parseFloat(N.toFixed(3)),
      currency: parseFloat(C.toFixed(3)),
    },
    scoreLabel: clamped > 0.3 ? "Bullish" : clamped < -0.3 ? "Bearish" : "Neutral",
  };
}

module.exports = { scoringEngine };
