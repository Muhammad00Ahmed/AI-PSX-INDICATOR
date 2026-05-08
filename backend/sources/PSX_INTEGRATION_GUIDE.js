/**
 * PSX Live Market Data Integration Guide
 * 
 * PRODUCTION DEPLOYMENT INSTRUCTIONS
 */

const guide = `
╔════════════════════════════════════════════════════════════════════════════╗
║         PSX INSTITUTIONAL-GRADE REAL-TIME DATA INTEGRATION GUIDE            ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 CURRENT STATUS
─────────────────────────────────────────────────────────────────────────────
The system is now architected for institutional-grade accuracy with:
  ✓ PSX data source abstraction layer
  ✓ Real-time WebSocket support (ready for PSX feed)
  ✓ Automatic polling fallback (1.5s intervals)
  ✓ Atomic state management with version control
  ✓ Tick-by-tick synchronization
  ✓ Race condition prevention
  ✓ Consistency validation


🔌 CONFIGURE LIVE PSX FEED (PRODUCTION)
─────────────────────────────────────────────────────────────────────────────

Option 1: PSX Official Market Data Feed (Recommended)
───────────────────────────────────────────────────
Requires: Commercial license from PSX

Prerequisites:
  - Contact PSX Market Data Services
  - Obtain API credentials
  - Get WebSocket endpoint
  - Ensure firewall allows connections

Setup:
  1. Add to .env:
     PSX_WS_URL=wss://live.psx.com.pk/v1/market (example)
     PSX_API_URL=https://api.psx.com.pk/v1/ticks (fallback)
     PSX_API_KEY=your_api_key_here

  2. Verify authentication in server startup
  3. Monitor /health endpoint for connection status

Data Format Expected:
  WebSocket: { symbol, price, change, changePercent, volume, timestamp, sequenceId }
  REST API:  { ticks: [...] } or raw tick object


Option 2: Licensed Data Provider
──────────────────────────────────
Popular providers for Pakistan:
  - Bloomberg Terminal (enterprise)
  - Reuters Eikon (enterprise)
  - Interactive Brokers API
  - Angel Broking (India, covers PSX)

Setup: Modify psxDataSource.js to map provider's format


Option 3: Authorized Broker WebSocket
──────────────────────────────────────
Some brokers provide real-time feeds:
  - Arif Habib
  - Invest.com.pk
  - Others (contact directly)

Integration: Update PSXDataSource.connectWebSocket() with broker endpoint


⚙️ DEPLOYMENT CHECKLIST
─────────────────────────────────────────────────────────────────────────────

[ ] 1. Configure Environment Variables (.env):
       PSX_WS_URL=wss://your-psx-endpoint
       PSX_API_URL=https://your-psx-api
       PSX_API_KEY=your-key
       NODE_ENV=production

[ ] 2. Start Backend:
       npm start

[ ] 3. Verify Connection:
       curl http://localhost:3001/health
       
       Expected response:
       {
         "status": "ok",
         "psx_connected": true,
         "ticks_received": 1234,
         "stocks": 150
       }

[ ] 4. Monitor Live Data:
       curl http://localhost:3001/api/market
       
       Verify:
       - All stock prices are current (within 1 tick)
       - Timestamps are recent (< 2 seconds old)
       - No null or stale values

[ ] 5. Load Test:
       - Verify WebSocket handles 50+ ticks/second
       - Check memory usage (should be stable < 500MB)
       - Verify no data loss or duplicates

[ ] 6. Production Monitoring:
       - Enable logging: LOG_LEVEL=debug
       - Monitor /health every 10 seconds
       - Alert on connection loss
       - Track tick accuracy vs PSX official display


🔍 VALIDATION & ACCURACY
─────────────────────────────────────────────────────────────────────────────

Ensure Tick-by-Tick Accuracy:
  1. Verify against PSX official market watch page
  2. Use /stats endpoint to monitor:
     - Total stocks updated
     - Gainers/losers/neutral counts
     - Total traded volume
  3. Check /health for consistency errors
  4. Log all validation failures


📊 API ENDPOINTS
─────────────────────────────────────────────────────────────────────────────

GET /health
  Returns: Connection status, tick count, stock count

GET /api/market
  Returns: All stocks, indices, version, timestamp

GET /api/stock/:symbol
  Returns: Single stock with full details

GET /api/stats
  Returns: Market statistics (gainers, losers, volume)

GET /api/indices
  Returns: KSE-100, KSE-30 with real-time values

WS://localhost:3001
  WebSocket: Receive real-time tick updates
  Message: { type: "tick", symbol, data, timestamp }


🚨 TROUBLESHOOTING
─────────────────────────────────────────────────────────────────────────────

Problem: Connection failed, using fallback polling
Solution:
  - Verify PSX_WS_URL is correct
  - Check firewall/proxy settings
  - Ensure credentials are valid
  - Check PSX service status

Problem: Prices not updating
Solution:
  - Check /health endpoint for connection status
  - Verify PSX market is open (9:30 AM - 3:30 PM PKT)
  - Check logs for validation errors
  - Verify API key/credentials

Problem: Stale data showing
Solution:
  - Check timestamp in API response (should be < 2s)
  - Verify version counter is increasing
  - Check for consistency errors in /health
  - Monitor tick rate (should be > 10/s during trading)

Problem: Memory leak or high CPU
Solution:
  - Check number of WebSocket subscribers
  - Verify no duplicate listeners
  - Monitor pendingUpdates queue
  - Restart service if needed


📚 TESTING IN DEVELOPMENT
─────────────────────────────────────────────────────────────────────────────

Without Live PSX Feed:
  - Use scraped data as fallback (current behavior)
  - System will warn about non-live data
  - Deploy test data via POST /test/inject-tick
  - Check /api/market for test data

With Mock PSX Feed:
  - Create psxDataSource.test.js
  - Implement mock WebSocket on port 3002
  - Send sample ticks every 100ms
  - Verify full pipeline works

Manual Testing:
  # Start background server
  npm start &

  # Test WebSocket connection
  wscat -c ws://localhost:3001

  # Inject test tick
  curl -X POST http://localhost:3001/test/inject-tick \\
    -H "Content-Type: application/json" \\
    -d '{"symbol":"PSO","price":450.25,"change":2.5,"changePercent":0.56,"volume":1000000}'

  # Verify in market data
  curl http://localhost:3001/api/market


⚡ PERFORMANCE TARGETS
─────────────────────────────────────────────────────────────────────────────

Institutional Grade Requirements:
  ✓ Data Latency: < 1 second (end-to-end)
  ✓ Update Frequency: 10-100+ ticks/second during trading
  ✓ Memory Usage: < 500MB (typical)
  ✓ CPU Usage: < 20% on avg hardware
  ✓ Uptime: > 99.9% during trading hours
  ✓ Accuracy: 100% tick-by-tick match with PSX


License & Terms of Use
─────────────────────────────────────────────────────────────────────────────
Ensure compliance with:
  - PSX Terms of Service
  - Data provider license agreement
  - Real-time data redistribution rules
  - Regulatory requirements (SECP)


Support & Escalation
─────────────────────────────────────────────────────────────────────────────
For issues:
  1. Check logs: tail -f logs/psx-*.log
  2. Review /health endpoint
  3. Contact data provider support
  4. Escalate to PSX Market Data Services
`;

console.log(guide);

module.exports = { guide };
