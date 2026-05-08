import { useReducer, useEffect, useRef, useCallback } from 'react';

const DEFAULT_BACKEND = 'https://ai-psx-indicator-1.onrender.com';
const API_BASE = import.meta.env.VITE_API_URL || (
  window.location.hostname.includes('vercel.app')
    ? `${DEFAULT_BACKEND}/api`
    : ''
);
const WS_BASE = import.meta.env.VITE_WS_URL || (
  window.location.hostname.includes('vercel.app')
    ? 'wss://ai-psx-indicator-1.onrender.com'
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001`
);

// ── Normalization ──────────────────────────────────────────────────────

function n(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeStock(raw) {
  if (!raw || !raw.symbol) return null;
  const price = n(raw.price);
  if (!price || price <= 0) return null;
  return {
    symbol:        String(raw.symbol).toUpperCase(),
    companyName:   String(raw.companyName || raw.name || raw.symbol),
    sector:        raw.sector || null,
    sectorCode:    raw.sectorCode || null,
    price,
    change:        n(raw.change, 0),
    changePercent: n(raw.changePercent, 0),
    open:          n(raw.open),
    high:          n(raw.high),
    low:           n(raw.low),
    ldcp:          n(raw.ldcp),
    volume:        n(raw.volume, 0),
    listedIn:      Array.isArray(raw.listedIn) ? raw.listedIn : [],
    isDebt:        Boolean(raw.isDebt),
    isETF:         Boolean(raw.isETF),
    timestamp:     n(raw.timestamp, Date.now()),
    source:        raw.source || 'unknown',
  };
}

function normalizeIndex(raw) {
  if (!raw) return null;
  return {
    name:          String(raw.name || '').toUpperCase(),
    value:         n(raw.value),
    change:        n(raw.change, 0),
    changePercent: n(raw.changePercent, 0),
    volume:        n(raw.volume, 0),
    timestamp:     n(raw.timestamp, Date.now()),
  };
}

// ── Reducer ────────────────────────────────────────────────────────────

const initState = {
  stocks:       {},   // symbol → stock
  indices:      {},   // name → index
  connected:    false,
  marketStatus: 'UNKNOWN',
  version:      0,
  lastUpdate:   null,
  error:        null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'CONNECTED':    return { ...state, connected: true, error: null };
    case 'DISCONNECTED': return { ...state, connected: false };
    case 'ERROR':        return { ...state, error: action.error };

    case 'INIT': {
      const stocks  = {};
      const indices = {};
      (action.stocks || []).forEach(raw => {
        const s = normalizeStock(raw);
        if (s) stocks[s.symbol] = s;
      });
      (action.indices || []).forEach(raw => {
        const idx = normalizeIndex(raw);
        if (idx) indices[idx.name] = idx;
      });
      return {
        ...state,
        stocks,
        indices,
        marketStatus: action.marketStatus || state.marketStatus,
        version:      action.version || state.version,
        lastUpdate:   Date.now(),
        connected:    true,
      };
    }

    case 'TICK': {
      const stock = normalizeStock(action.data);
      if (!stock) return state;
      const existing = state.stocks[stock.symbol];
      // latest-tick-wins
      if (existing && existing.timestamp >= stock.timestamp) return state;
      return {
        ...state,
        stocks:    { ...state.stocks, [stock.symbol]: stock },
        version:   action.version || state.version,
        lastUpdate: Date.now(),
      };
    }

    case 'TICK_BATCH': {
      const updates = {};
      let changed = false;
      (action.stocks || []).forEach(raw => {
        const s = normalizeStock(raw);
        if (!s) return;
        const existing = state.stocks[s.symbol];
        if (!existing || existing.timestamp < s.timestamp) {
          updates[s.symbol] = s;
          changed = true;
        }
      });
      if (!changed) return state;
      return {
        ...state,
        stocks:    { ...state.stocks, ...updates },
        version:   action.version || state.version,
        lastUpdate: Date.now(),
      };
    }

    case 'INDEX_UPDATE': {
      const idx = normalizeIndex(action.data);
      if (!idx || !idx.name) return state;
      return {
        ...state,
        indices:    { ...state.indices, [idx.name]: idx },
        lastUpdate: Date.now(),
      };
    }

    case 'HEARTBEAT':
      return {
        ...state,
        marketStatus: action.marketStatus || state.marketStatus,
        version:      action.version ?? state.version,
      };

    case 'SNAPSHOT': {
      const stocks  = {};
      const indices = {};
      (action.stocks || []).forEach(raw => {
        const s = normalizeStock(raw);
        if (s) stocks[s.symbol] = s;
      });
      (action.indices || []).forEach(raw => {
        const idx = normalizeIndex(raw);
        if (idx) indices[idx.name] = idx;
      });
      return { ...state, stocks, indices, version: action.version || state.version, lastUpdate: Date.now() };
    }

    default:
      return state;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

export function useMarketData() {
  const [state, dispatch] = useReducer(reducer, initState);
  const wsRef         = useRef(null);
  const reconnectRef  = useRef(0);
  const mountedRef    = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectRef.current = 0;
      dispatch({ type: 'CONNECTED' });
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'INIT':
            dispatch({ type: 'INIT', ...msg.payload, version: msg.version });
            break;
          case 'TICK':
            dispatch({ type: 'TICK', data: msg.payload.data, symbol: msg.payload.symbol, version: msg.version });
            break;
          case 'TICK_BATCH':
            dispatch({ type: 'TICK_BATCH', stocks: msg.payload.stocks, version: msg.version });
            break;
          case 'INDEX_UPDATE':
            dispatch({ type: 'INDEX_UPDATE', data: msg.payload.data });
            break;
          case 'SNAPSHOT':
            dispatch({ type: 'SNAPSHOT', ...msg.payload, version: msg.version });
            break;
          case 'HEARTBEAT':
            dispatch({ type: 'HEARTBEAT', marketStatus: msg.payload.marketStatus, version: msg.payload.version });
            break;
        }
      } catch (_) { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      dispatch({ type: 'DISCONNECTED' });
      // Reconnect with backoff
      const delay = WS_RECONNECT_DELAYS[Math.min(reconnectRef.current, WS_RECONNECT_DELAYS.length - 1)];
      reconnectRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      dispatch({ type: 'ERROR', error: 'WebSocket error' });
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Initial HTTP load as fallback
    fetch(`${API_BASE}/api/market`)
      .then(r => r.json())
      .then(data => {
        if (mountedRef.current && !state.lastUpdate) {
          dispatch({
            type: 'INIT',
            stocks:  data.stocks  || [],
            indices: data.indices || [],
            marketStatus: data.marketStatus,
            version: data.version,
          });
        }
      })
      .catch(() => {});

    connect();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  // Derived arrays (memoized via useMemo in consumers)
  const stocksArray  = Object.values(state.stocks);
  const indicesArray = Object.values(state.indices);
  const kse100       = state.indices['KSE100'] || null;
  const kse30        = state.indices['KSE30']  || null;

  const getStock = (sym) => state.stocks[sym?.toUpperCase()] || null;
  const gainers  = [...stocksArray].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10);
  const losers   = [...stocksArray].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10);
  const active   = [...stocksArray].sort((a, b) => b.volume - a.volume).slice(0, 10);

  return {
    stocks:       stocksArray,
    indices:      indicesArray,
    kse100,
    kse30,
    connected:    state.connected,
    marketStatus: state.marketStatus,
    version:      state.version,
    lastUpdate:   state.lastUpdate,
    error:        state.error,
    getStock,
    gainers,
    losers,
    active,
  };
}
