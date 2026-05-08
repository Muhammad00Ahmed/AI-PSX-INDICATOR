/**
 * ⚡ ULTRA-FAST PSX SCRAPER (SINGLE FILE)
 * Near real-time scraping (~1s)
 * MutationObserver-based (event-driven)
 * No overlap, no lag
 */

const puppeteer = require("puppeteer");
const EventEmitter = require("events");

class PSXScraper extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.scrapedData = new Map();
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    this.page = await this.browser.newPage();

    await this.page.setRequestInterception(true);
    this.page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await this.page.goto("https://www.psx.com.pk/market-watch", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await this.page.waitForSelector("tbody tr", { timeout: 15000 });

    // Inject mutation observer
    await this.page.evaluate(() => {
      window.__UPDATED = false;

      const observer = new MutationObserver(() => {
        window.__UPDATED = true;
      });

      const target = document.querySelector("tbody");
      if (target) {
        observer.observe(target, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    });

    console.log("✅ PSX Scraper Ready");
  }

  async extract() {
    return await this.page.evaluate(() => {
      const rows = document.querySelectorAll("tbody tr[data-symbol]");
      const result = [];

      for (let row of rows) {
        const symbol = row.getAttribute("data-symbol");
        if (!symbol) continue;

        const price = parseFloat(
          (row.children[2]?.textContent || "").replace(/,/g, "")
        );

        if (!price || isNaN(price)) continue;

        result.push({
          symbol,
          price,
          change: parseFloat(row.children[7]?.textContent || "0"),
          changePercent: parseFloat(
            (row.children[8]?.textContent || "0").replace("%", "")
          ),
          volume: parseInt(
            (row.children[9]?.textContent || "0").replace(/,/g, "")
          ),
          timestamp: Date.now()
        });
      }

      return result;
    });
  }

  async loop() {
    while (this.isRunning) {
      try {
        // Wait for DOM update OR timeout
        await this.page.waitForFunction(() => window.__UPDATED === true, {
          timeout: 1000
        }).catch(() => {});

        await this.page.evaluate(() => window.__UPDATED = false);

        const stocks = await this.extract();

        let updated = false;

        for (let stock of stocks) {
          const prev = this.scrapedData.get(stock.symbol);

          if (!prev || prev.price !== stock.price) {
            this.scrapedData.set(stock.symbol, stock);
            updated = true;
          }
        }

        if (updated) {
          this.emit("data", {
            stocks: Array.from(this.scrapedData.values()),
            timestamp: Date.now()
          });

          console.log(
            `⚡ Updated ${stocks.length} stocks @ ${new Date().toLocaleTimeString()}`
          );
        }

      } catch (err) {
        console.error("❌ Loop Error:", err.message);
      }
    }
  }

  async start() {
    await this.init();
    this.isRunning = true;
    this.loop();
  }

  async stop() {
    this.isRunning = false;
    if (this.browser) await this.browser.close();
    console.log("🛑 Scraper Stopped");
  }

  getStock(symbol) {
    return this.scrapedData.get(symbol.toUpperCase());
  }

  getAll() {
    return Array.from(this.scrapedData.values());
  }
}

// 🚀 RUN DIRECTLY
if (require.main === module) {
  const scraper = new PSXScraper();

  scraper.on("data", (data) => {
    // Example: log first 3 stocks
    console.log(data.stocks.slice(0, 3));
  });

  scraper.start();

  // Stop after 10 mins (optional)
  setTimeout(() => scraper.stop(), 10 * 60 * 1000);
}

module.exports = PSXScraper;