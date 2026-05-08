const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");

const client = new Anthropic(); // Uses ANTHROPIC_API_KEY from env

const DISCLAIMER =
  "For informational purposes only. Not financial advice. Past market behavior does not guarantee future results.";

function buildPrompt(stocks, news, currency) {
  const topMovers = [...stocks]
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5);

  const topGainers = stocks.filter((s) => s.change > 0).sort((a, b) => b.change - a.change).slice(0, 3);
  const topLosers = stocks.filter((s) => s.change < 0).sort((a, b) => a.change - b.change).slice(0, 3);

  const avgChange = (stocks.reduce((s, x) => s + x.change, 0) / stocks.length).toFixed(2);
  const moodLabel = avgChange > 0.5 ? "Bullish" : avgChange < -0.5 ? "Bearish" : "Mixed";

  const newsHeadlines = news.slice(0, 5).map((n) => `[${n.sentiment.toUpperCase()}] ${n.title}`).join("\n");

  return `You are a senior Pakistan Stock Exchange (PSX) market research analyst. Analyze the following real-time market snapshot and generate a structured briefing.

CURRENT MARKET DATA:
- KSE-100 Index Change: ${avgChange}% (Mood: ${moodLabel})
- USD/PKR: ${currency?.rate} (${currency?.direction || "stable"})
- Market Average Change: ${avgChange}%

TOP MOVERS:
${topMovers.map((s) => `${s.symbol}: ${s.change > 0 ? "+" : ""}${s.change}% | Vol: ${(s.volume / 1e6).toFixed(1)}M | Signal: ${s.signalLabel}`).join("\n")}

TOP GAINERS: ${topGainers.map((s) => `${s.symbol} +${s.change}%`).join(", ")}
TOP LOSERS: ${topLosers.map((s) => `${s.symbol} ${s.change}%`).join(", ")}

RECENT NEWS SENTIMENT:
${newsHeadlines}

Generate a structured market briefing with EXACTLY these 5 sections using these headers:

📌 WHAT IS HAPPENING
[2-3 sentences describing current market activity]

📊 WHY IT IS HAPPENING  
[2-3 sentences on the probable drivers/catalysts]

⚠️ RISK LEVEL
[1-2 sentences on key risks to monitor. Label overall risk as: LOW / MEDIUM / HIGH]

📉 MARKET CONTEXT
[2-3 sentences on broader macro/sector context for Pakistan]

🧭 SUGGESTED CAUTION
[2-3 sentences of measured, probabilistic observations. Never use BUY/SELL. Use phrases like "indicates", "suggests", "may reflect", "could signal"]

STRICT RULES:
- Never say BUY, SELL, INVEST, or guarantee any outcome
- Use probabilistic language throughout
- Keep each section concise (2-3 sentences max)
- Focus on PSX-specific context`;
}

async function generateInsight(stocks, news, currency) {
  try {
    const prompt = buildPrompt(stocks, news, currency);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.text || "";

    // Parse sections
    const sections = parseSections(text);

    return {
      raw: text,
      sections,
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString(),
      dataPoints: {
        stocksAnalyzed: stocks.length,
        newsArticles: news.length,
        usdPkr: currency?.rate,
      },
    };
  } catch (err) {
    console.error("[INSIGHT] API error:", err.message);
    return generateFallbackInsight(stocks, currency);
  }
}

function parseSections(text) {
  const patterns = [
    { key: "happening", header: "📌 WHAT IS HAPPENING" },
    { key: "why", header: "📊 WHY IT IS HAPPENING" },
    { key: "risk", header: "⚠️ RISK LEVEL" },
    { key: "context", header: "📉 MARKET CONTEXT" },
    { key: "caution", header: "🧭 SUGGESTED CAUTION" },
  ];

  const sections = {};
  patterns.forEach(({ key, header }, i) => {
    const start = text.indexOf(header);
    if (start === -1) { sections[key] = ""; return; }
    const nextHeader = i < patterns.length - 1 ? text.indexOf(patterns[i + 1].header) : text.length;
    const content = text.slice(start + header.length, nextHeader !== -1 ? nextHeader : undefined).trim();
    sections[key] = content;
  });

  return sections;
}

function generateFallbackInsight(stocks, currency) {
  const avgChange = (stocks.reduce((s, x) => s + x.change, 0) / stocks.length).toFixed(2);
  const mood = avgChange > 0 ? "positive" : "cautious";
  const gainers = stocks.filter((s) => s.change > 0).length;
  const losers = stocks.filter((s) => s.change < 0).length;

  return {
    sections: {
      happening: `The PSX market is showing ${mood} movement with ${gainers} gainers and ${losers} decliners across tracked securities. The average price movement suggests ${avgChange > 0 ? "broad-based buying interest" : "selling pressure across sectors"}.`,
      why: `Market activity may reflect ongoing macroeconomic developments including USD/PKR at ${currency?.rate || "N/A"} and investor positioning ahead of key data releases. Sector rotations appear to be influencing intraday patterns.`,
      risk: `Risk Level: ${Math.abs(parseFloat(avgChange)) > 1.5 ? "MEDIUM-HIGH" : "LOW-MEDIUM"}. Key risks include currency volatility, external account dynamics, and global commodity price movements affecting Pakistan's import bill.`,
      context: `Pakistan's equity market continues to respond to IMF program developments, monetary policy expectations, and corporate earnings cycle. The energy and banking sectors remain closely watched by institutional participants.`,
      caution: `Current price behavior suggests selective participation may be warranted. Volume patterns indicate mixed conviction. Investors may wish to monitor policy announcements and SBP communications which historically influence broad market direction.`,
    },
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
    dataPoints: { stocksAnalyzed: stocks.length, usdPkr: currency?.rate },
  };
}

module.exports = { generateInsight };
