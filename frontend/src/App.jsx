import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { useMarketData } from './hooks/useMarketData';
import { useCandleData } from './hooks/useCandleData';
import './App.css';

// ── Formatting Helpers ────────────────────────────────────────────────

const fmt  = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');
const fmtV = (v) => {
  if (!v || !Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};
const fmtI = (n) => n != null && Number.isFinite(n)
  ? n.toLocaleString('en-PK', { maximumFractionDigits: 2 }) : '—';

// ── Status Badge ──────────────────────────────────────────────────────

function MarketStatusBadge({ status }) {
  const map = {
    OPEN:       { cls: 'badge-green',  label: '● MARKET OPEN' },
    PRE_MARKET: { cls: 'badge-yellow', label: '◐ PRE-MARKET' },
    CLOSED:     { cls: 'badge-red',    label: '○ CLOSED' },
    WEEKEND:    { cls: 'badge-gray',   label: '○ WEEKEND' },
    UNKNOWN:    { cls: 'badge-gray',   label: '? UNKNOWN' },
  };
  const { cls, label } = map[status] || map.UNKNOWN;
  return <span className={`market-badge ${cls}`}>{label}</span>;
}

// ── Live Dot ──────────────────────────────────────────────────────────

function LiveDot({ active }) {
  return <span className={`live-dot ${active ? 'live-dot-on' : ''}`} />;
}

// ── Index Card ────────────────────────────────────────────────────────

function IndexCard({ index, label }) {
  if (!index) return (
    <div className="index-card index-card--empty">
      <div className="index-card__name">{label}</div>
      <div className="index-card__value">—</div>
    </div>
  );

  const up = index.changePercent >= 0;
  return (
    <div className={`index-card ${up ? 'index-card--up' : 'index-card--down'}`}>
      <div className="index-card__name">{label}</div>
      <div className="index-card__value">{fmtI(index.value)}</div>
      <div className={`index-card__change ${up ? 'text-up' : 'text-down'}`}>
        {up ? '▲' : '▼'} {fmt(Math.abs(index.change))} ({fmt(Math.abs(index.changePercent))}%)
      </div>
      <div className="index-card__vol">Vol: {fmtV(index.volume)}</div>
    </div>
  );
}

// ── Price Flash ───────────────────────────────────────────────────────

function PriceCell({ price, symbol }) {
  const prevRef  = useRef(price);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (prevRef.current === price) return;
    const dir = price > prevRef.current ? 'flash-up' : 'flash-down';
    prevRef.current = price;
    setFlash(dir);
    const t = setTimeout(() => setFlash(''), 600);
    return () => clearTimeout(t);
  }, [price]);

  return <span className={`price-cell ${flash}`}>₨{fmt(price)}</span>;
}

// ── Ticker Tape ───────────────────────────────────────────────────────

function TickerTape({ stocks }) {
  const items = useMemo(() =>
    stocks
      .filter(s => s.price > 0)
      .slice(0, 40)
      .map(s => ({
        sym: s.symbol,
        price: fmt(s.price),
        pct:   fmt(Math.abs(s.changePercent)),
        up:    s.changePercent >= 0,
      })),
    [stocks]
  );

  if (!items.length) return null;

  return (
    <div className="ticker-wrap">
      <div className="ticker-tape">
        {[...items, ...items].map((s, i) => (
          <span key={i} className={`ticker-item ${s.up ? 'ticker-up' : 'ticker-down'}`}>
            <b>{s.sym}</b> {s.price} <span>{s.up ? '▲' : '▼'}{s.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Simple Sparkline (SVG) ────────────────────────────────────────────

function Sparkline({ candles, w = 80, h = 28 }) {
  if (!candles || candles.length < 2) return <span className="spark-empty" />;
  const prices = candles.map(c => c.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const up = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={pts} fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="1.5" />
    </svg>
  );
}

// ── Chart (Lightweight Charts) ────────────────────────────────────────

function CandleChart({ symbol }) {
  const { candles, loading } = useCandleData(symbol, 60, 200);
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    import('lightweight-charts').then(({ createChart }) => {
      if (chartRef.current) { chartRef.current.remove(); }

      const chart = createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height: 320,
        layout: { background: { color: '#ffffff' }, textColor: '#374151' },
        grid:   { vertLines: { color: '#e5e7eb' }, horzLines: { color: '#e5e7eb' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale:       { borderColor: '#334155', timeVisible: true },
      });

      const series = chart.addCandlestickSeries({
        upColor:     '#22c55e',
        downColor:   '#ef4444',
        borderUpColor:   '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor:   '#22c55e',
        wickDownColor: '#ef4444',
      });

      chartRef.current  = chart;
      seriesRef.current = series;

      if (candles.length) {
        const data = candles.map(c => ({
          time:  Math.floor(c.time / 1000),
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        })).filter(c => c.open && c.high && c.low && c.close);
        if (data.length) series.setData(data);
      }

      const obs = new ResizeObserver(() => {
        chart.applyOptions({ width: containerRef.current?.clientWidth || 600 });
      });
      obs.observe(containerRef.current);

      return () => { obs.disconnect(); chart.remove(); };
    });
  }, [symbol]);

  // Update series when candles change
  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    const data = candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    })).filter(c => c.open && c.high && c.low && c.close);
    if (data.length) seriesRef.current.setData(data);
  }, [candles]);

  return (
    <div className="chart-wrap">
      {loading && <div className="chart-loading">Loading chart…</div>}
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}

// ── Line Chart ────────────────────────────────────────────────────────

function LineChart({ symbol }) {
  const { candles, loading } = useCandleData(symbol, 60, 200);
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    import('lightweight-charts').then(({ createChart }) => {
      if (chartRef.current) { chartRef.current.remove(); }

      const chart = createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height: 320,
        layout: { background: { color: '#ffffff' }, textColor: '#374151' },
        grid:   { vertLines: { color: '#e5e7eb' }, horzLines: { color: '#e5e7eb' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale:       { borderColor: '#334155', timeVisible: true },
      });

      const series = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });

      chartRef.current  = chart;
      seriesRef.current = series;

      if (candles.length) {
        const data = candles.map(c => ({
          time:  Math.floor(c.time / 1000),
          value: c.close,
        })).filter(c => c.value && Number.isFinite(c.value));
        if (data.length) series.setData(data);
      }

      const obs = new ResizeObserver(() => {
        chart.applyOptions({ width: containerRef.current?.clientWidth || 600 });
      });
      obs.observe(containerRef.current);

      return () => { obs.disconnect(); chart.remove(); };
    });
  }, [symbol]);

  // Update series when candles change
  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    const data = candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      value: c.close,
    })).filter(c => c.value && Number.isFinite(c.value));
    if (data.length) seriesRef.current.setData(data);
  }, [candles]);

  return (
    <div className="chart-wrap">
      {loading && <div className="chart-loading">Loading chart…</div>}
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}

// ── Stock Row ─────────────────────────────────────────────────────────

const StockRow = memo(function StockRow({ stock, onClick, selected, onAddToPortfolio, inPortfolio }) {
  const up = stock.changePercent >= 0;
  return (
    <tr className={`stock-row ${selected ? 'stock-row--selected' : ''}`} onClick={() => onClick(stock)}>
      <td className="col-symbol">
        <div className="sym">{stock.symbol}</div>
        <div className="company-name">{stock.companyName?.slice(0, 24) || ''}</div>
      </td>
      <td className="col-price">
        <PriceCell price={stock.price} symbol={stock.symbol} />
      </td>
      <td className={`col-change ${up ? 'text-up' : 'text-down'}`}>
        {up ? '▲' : '▼'} {fmt(Math.abs(stock.change))}
      </td>
      <td className={`col-pct ${up ? 'text-up' : 'text-down'}`}>
        {up ? '+' : ''}{fmt(stock.changePercent)}%
      </td>
      <td className="col-vol">{fmtV(stock.volume)}</td>
      <td className="col-high">{fmt(stock.high)}</td>
      <td className="col-low">{fmt(stock.low)}</td>
      <td className="col-ldcp">{fmt(stock.ldcp)}</td>
      <td style={{ textAlign: 'center' }}>
        <button className={`add-btn ${inPortfolio ? 'add-btn--update' : ''}`} onClick={(e) => { e.stopPropagation(); onAddToPortfolio(stock); }}>
          {inPortfolio ? '✎ Update' : '✚ Add'}
        </button>
      </td>
    </tr>
  );
});

// ── Mini Movers List ─────────────────────────────────────────────────

function MoverList({ items, label, type }) {
  return (
    <div className="mover-list">
      <h4 className="mover-title">{label}</h4>
      {items.slice(0, 8).map(s => {
        const up = s.changePercent >= 0;
        return (
          <div key={s.symbol} className="mover-row">
            <span className="mover-sym">{s.symbol}</span>
            <span className="mover-price">₨{fmt(s.price)}</span>
            <span className={`mover-pct ${up ? 'text-up' : 'text-down'}`}>
              {up ? '+' : ''}{fmt(s.changePercent)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Heatmap ──────────────────────────────────────────────────────────

function Heatmap({ stocks }) {
  const items = useMemo(() =>
    stocks
      .filter(s => s.price > 0 && Number.isFinite(s.changePercent))
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 60),
    [stocks]
  );

  const getColor = (pct) => {
    const intensity = Math.min(Math.abs(pct) / 5, 1);
    if (pct > 0) return `rgba(34,197,94,${0.15 + intensity * 0.75})`;
    if (pct < 0) return `rgba(239,68,68,${0.15 + intensity * 0.75})`;
    return 'rgba(100,116,139,0.3)';
  };

  return (
    <div className="heatmap">
      {items.map(s => (
        <div key={s.symbol} className="heatmap-cell" style={{ background: getColor(s.changePercent) }}>
          <div className="hm-sym">{s.symbol}</div>
          <div className="hm-pct">{fmt(s.changePercent)}%</div>
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────

const TABS = ['Market', 'Gainers/Losers', 'Heatmap', 'Portfolio', 'Chart'];
const SORT_FIELDS = ['symbol', 'price', 'changePercent', 'volume', 'high', 'low'];

export default function App() {
  const market = useMarketData();
  const [tab,          setTab]          = useState('Market');
  const [search,       setSearch]       = useState('');
  const [sortField,    setSortField]    = useState('changePercent');
  const [sortDir,      setSortDir]      = useState('desc');
  const [selectedStock, setSelectedStock] = useState(null);
  const [showKSE100,   setShowKSE100]   = useState(false);
  const [portfolio,    setPortfolio]    = useState(() => {
    const saved = localStorage.getItem('psx-portfolio');
    return saved ? JSON.parse(saved) : [];
  });
  const [chartType, setChartType] = useState('candle');

  const openAddForm = (stock) => {
    setFormStock(stock);
    setFormQty('1');
    setFormBuyPrice(stock.price.toString());
    setShowAddForm(true);
  };

  const submitAddToPortfolio = () => {
    if (!formStock || !formQty || !formBuyPrice || isNaN(formQty) || isNaN(formBuyPrice) || formQty <= 0 || formBuyPrice <= 0) {
      alert('Please enter valid quantity and buy price');
      return;
    }
    const newHolding = { symbol: formStock.symbol, quantity: parseFloat(formQty), buyPrice: parseFloat(formBuyPrice), dateAdded: new Date().toISOString() };
    setPortfolio(prev => {
      const updated = [...prev.filter(h => h.symbol !== formStock.symbol), newHolding];
      localStorage.setItem('psx-portfolio', JSON.stringify(updated));
      return updated;
    });
    setShowAddForm(false);
  };

  const removeFromPortfolio = (symbol) => {
    if (!window.confirm(`Remove ${symbol} from portfolio?`)) return;
    setPortfolio(prev => {
      const updated = prev.filter(h => h.symbol !== symbol);
      localStorage.setItem('psx-portfolio', JSON.stringify(updated));
      return updated;
    });
  };

  const filteredStocks = useMemo(() => {
    let list = market.stocks.filter(s => s.price > 0 && !s.isDebt);

    if (showKSE100) {
      list = list.filter(s => s.listedIn?.includes('KSE100') || list.length < 100);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s =>
        s.symbol.toLowerCase().includes(q) ||
        (s.companyName || '').toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [market.stocks, search, sortField, sortDir, showKSE100]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (f) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <span className="logo">PSX<span className="logo-pro"> PRO</span></span>
          <LiveDot active={market.connected} />
          <MarketStatusBadge status={market.marketStatus} />
        </div>
        <div className="header-indices">
          <IndexCard index={market.kse100} label="KSE-100" />
          <IndexCard index={market.kse30}  label="KSE-30" />
        </div>
        <div className="header-right">
          <span className="header-stats">
            {market.stocks.length} stocks
            {market.lastUpdate ? ` · ${new Date(market.lastUpdate).toLocaleTimeString('en-PK')}` : ''}
          </span>
        </div>
      </header>

      {/* ── Ticker Tape ── */}
      <TickerTape stocks={market.stocks} />

      {/* ── Tabs ── */}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={`tab-btn ${tab === t ? 'tab-btn--active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <label className="kse-filter">
          <input type="checkbox" checked={showKSE100} onChange={e => setShowKSE100(e.target.checked)} />
          {' '}KSE-100 Only
        </label>
      </nav>

      {/* ── Content ── */}
      <main className="main-content">
        {/* Selected stock sidebar */}
        {selectedStock && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div>
                <div className="sidebar-symbol">{selectedStock.symbol}</div>
                <div className="sidebar-name">{selectedStock.companyName}</div>
              </div>
              <button className="close-btn" onClick={() => setSelectedStock(null)}>×</button>
            </div>
            <div className="sidebar-price">
              ₨{fmt(selectedStock.price)}
              <span className={selectedStock.changePercent >= 0 ? 'text-up' : 'text-down'}>
                {' '}{selectedStock.changePercent >= 0 ? '+' : ''}{fmt(selectedStock.changePercent)}%
              </span>
            </div>
            <div className="sidebar-grid">
              <div><span>Open</span><b>₨{fmt(selectedStock.open)}</b></div>
              <div><span>High</span><b className="text-up">₨{fmt(selectedStock.high)}</b></div>
              <div><span>Low</span><b className="text-down">₨{fmt(selectedStock.low)}</b></div>
              <div><span>Prev Close</span><b>₨{fmt(selectedStock.ldcp)}</b></div>
              <div><span>Volume</span><b>{fmtV(selectedStock.volume)}</b></div>
              <div><span>Sector</span><b>{selectedStock.sector || '—'}</b></div>
            </div>
            <CandleChart symbol={selectedStock.symbol} />
          </aside>
        )}

        <div className={`panel ${selectedStock ? 'panel--narrow' : ''}`}>
          {tab === 'Market' && (
            <>
              <div className="toolbar">
                <input
                  className="search-input"
                  placeholder="Search symbol or company…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <span className="result-count">{filteredStocks.length} results</span>
              </div>

              <div className="table-wrap">
                <table className="market-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('symbol')}>Symbol{sortIcon('symbol')}</th>
                      <th onClick={() => handleSort('price')}>Price{sortIcon('price')}</th>
                      <th onClick={() => handleSort('change')}>Change{sortIcon('change')}</th>
                      <th onClick={() => handleSort('changePercent')}>%{sortIcon('changePercent')}</th>
                      <th onClick={() => handleSort('volume')}>Volume{sortIcon('volume')}</th>
                      <th onClick={() => handleSort('high')}>High{sortIcon('high')}</th>
                      <th onClick={() => handleSort('low')}>Low{sortIcon('low')}</th>
                      <th>Prev Close</th>
                      <th>Portfolio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.map(s => (
                      <StockRow
                        key={s.symbol}
                        stock={s}
                        onClick={setSelectedStock}
                        selected={selectedStock?.symbol === s.symbol}
                        onAddToPortfolio={openAddForm}
                        inPortfolio={portfolio.some(h => h.symbol === s.symbol)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'Gainers/Losers' && (
            <div className="movers-grid">
              <MoverList items={market.gainers} label="🚀 Top Gainers" type="gain" />
              <MoverList items={market.losers}  label="📉 Top Losers"  type="loss" />
              <MoverList items={market.active}  label="🔥 Most Active" type="vol" />
            </div>
          )}

          {tab === 'Heatmap' && (
            <div className="heatmap-wrap">
              <h3 className="section-title">Market Heatmap</h3>
              <Heatmap stocks={market.stocks} />
            </div>
          )}

          {tab === 'Portfolio' && (
            <div className="portfolio-tab">
              <div className="portfolio-header">
                <h3 className="section-title">📊 My Portfolio</h3>
                <button className="btn-add-stock" onClick={() => setTab('Market')}>＋ Add Stock</button>
              </div>
              {portfolio.length === 0 ? (
                <div className="portfolio-empty">
                  <div className="empty-icon">📈</div>
                  <p>No stocks in your portfolio yet</p>
                  <small>Go to Market tab and click "Add" to get started</small>
                </div>
              ) : (
                <>
                  <div className="portfolio-stats">
                    {(() => {
                      const totalValue = portfolio.reduce((sum, h) => { const stock = market.getStock(h.symbol); return sum + (stock ? stock.price * h.quantity : 0); }, 0);
                      const totalCost = portfolio.reduce((sum, h) => sum + h.buyPrice * h.quantity, 0);
                      const totalPL = totalValue - totalCost;
                      const totalPLPct = totalCost > 0 ? ((totalValue / totalCost) - 1) * 100 : 0;
                      return (
                        <>
                          <div className="stat-card">
                            <span className="stat-label">Total Value</span>
                            <span className="stat-value">₨{fmt(totalValue)}</span>
                          </div>
                          <div className="stat-card">
                            <span className="stat-label">Total Cost</span>
                            <span className="stat-value">₨{fmt(totalCost)}</span>
                          </div>
                          <div className={`stat-card ${totalPL >= 0 ? 'stat-profit' : 'stat-loss'}`}>
                            <span className="stat-label">Total P/L</span>
                            <span className="stat-value">₨{fmt(totalPL)} ({fmt(totalPLPct)}%)</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="portfolio-list">
                    {portfolio.map(h => {
                      const stock = market.getStock(h.symbol);
                      if (!stock) return null;
                      const currentValue = stock.price * h.quantity;
                      const cost = h.buyPrice * h.quantity;
                      const pl = currentValue - cost;
                      const plPct = ((stock.price / h.buyPrice) - 1) * 100;
                      const isProfit = pl >= 0;
                      return (
                        <div key={h.symbol} className={`portfolio-item ${isProfit ? 'item-profit' : 'item-loss'}`}>
                          <div className="item-left">
                            <div className="item-symbol">{h.symbol}</div>
                            <div className="item-company">{stock.companyName?.slice(0, 20) || ''}</div>
                          </div>
                          <div className="item-middle">
                            <div className="item-row"><span>Qty:</span> <b>{h.quantity}</b></div>
                            <div className="item-row"><span>Buy Price:</span> <b>₨{fmt(h.buyPrice)}</b></div>
                            <div className="item-row"><span>Current:</span> <b className={isProfit ? 'text-up' : 'text-down'}>₨{fmt(stock.price)}</b></div>
                          </div>
                          <div className="item-right">
                            <div className="item-value">₨{fmt(currentValue)}</div>
                            <div className={`item-pl ${isProfit ? 'text-up' : 'text-down'}`}>
                              {isProfit ? '▲' : '▼'} ₨{fmt(Math.abs(pl))}
                            </div>
                            <div className={`item-pct ${isProfit ? 'text-up' : 'text-down'}`}>
                              {isProfit ? '+' : ''}{fmt(plPct)}%
                            </div>
                          </div>
                          <div className="item-actions">
                            <button className="btn-edit" onClick={() => openAddForm(stock)}>✎</button>
                            <button className="btn-delete" onClick={() => removeFromPortfolio(h.symbol)}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="heatmap-section">
                    <h4>🔥 Portfolio Heatmap</h4>
                    <Heatmap stocks={portfolio.map(h => market.getStock(h.symbol)).filter(Boolean)} />
                  </div>
                </>
              )}
            </div>
          )}

          {showAddForm && formStock && (
            <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
              <div className="modal-form" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{formStock.symbol} - Add to Portfolio</h3>
                  <button className="modal-close" onClick={() => setShowAddForm(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Stock</label>
                    <input type="text" disabled value={formStock.symbol} className="form-input-disabled" />
                  </div>
                  <div className="form-group">
                    <label>Company</label>
                    <input type="text" disabled value={formStock.companyName} className="form-input-disabled" />
                  </div>
                  <div className="form-group">
                    <label>Current Price: ₨{fmt(formStock.price)}</label>
                    <div className="price-display">₨{fmt(formStock.price)}</div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Quantity *</label>
                      <input type="number" min="1" step="1" value={formQty} onChange={(e) => setFormQty(e.target.value)} className="form-input" placeholder="Enter quantity" />
                    </div>
                    <div className="form-group">
                      <label>Buy Price (₨) *</label>
                      <input type="number" min="0.01" step="0.01" value={formBuyPrice} onChange={(e) => setFormBuyPrice(e.target.value)} className="form-input" placeholder="Enter buy price" />
                    </div>
                  </div>
                  {formQty && formBuyPrice && (
                    <div className="form-summary">
                      <div>Total Cost: <b>₨{fmt(parseFloat(formQty) * parseFloat(formBuyPrice))}</b></div>
                      <div>Current Value: <b>₨{fmt(parseFloat(formQty) * formStock.price)}</b></div>
                      <div className={parseFloat(formQty) * formStock.price >= parseFloat(formQty) * parseFloat(formBuyPrice) ? 'text-up' : 'text-down'}>
                        Estimated P/L: <b>₨{fmt(parseFloat(formQty) * (formStock.price - parseFloat(formBuyPrice)))}</b>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
                  <button className="btn-submit" onClick={submitAddToPortfolio}>Add to Portfolio</button>
                </div>
              </div>
            </div>
          )}

          {tab === 'Chart' && (
            <div className="chart-tab">
              <div className="chart-controls">
                <h3 className="section-title">Stock Charts</h3>
                {selectedStock && (
                  <div className="chart-type-toggle">
                    <button
                      className={`chart-type-btn ${chartType === 'candle' ? 'active' : ''}`}
                      onClick={() => setChartType('candle')}
                    >
                      📊 Candle
                    </button>
                    <button
                      className={`chart-type-btn ${chartType === 'line' ? 'active' : ''}`}
                      onClick={() => setChartType('line')}
                    >
                      📈 Line
                    </button>
                  </div>
                )}
              </div>

              {!selectedStock ? (
                <div className="chart-placeholder">
                  <div className="chart-placeholder-icon">📈</div>
                  <p>Select a stock from the Market tab to view its chart</p>
                </div>
              ) : (
                <>
                  {chartType === 'candle' && <CandleChart symbol={selectedStock.symbol} />}
                  {chartType === 'line' && <LineChart symbol={selectedStock.symbol} />}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
