'use strict';

require('dotenv').config();

const http    = require('http');
const express = require('express');
const cors    = require('cors');

const logger           = require('./utils/logger');
const apiRoutes        = require('./api/routes');
const BroadcastServer  = require('./websocket/broadcastServer');
const { getOrchestrator } = require('./scraper/orchestrator');
const { getCache }        = require('./pipeline/cache');
const { getWatchdog }     = require('./monitoring/watchdog');

const PORT         = Number(process.env.PORT)  || 3001;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',');

// ── Express App ──────────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
    cb(null, true); // allow all in dev; restrict in production via env
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Request logging (lightweight)
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'HTTP');
  next();
});

// API routes
app.use('/api', apiRoutes);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  logger.error({ err: err.message }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── HTTP + WebSocket Server ──────────────────────────────────────────

const server = http.createServer(app);
const wsServer = new BroadcastServer(server);

// ── Graceful Shutdown ────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down...');

  try {
    await getOrchestrator().stop();
    getWatchdog().stop();
    wsServer.shutdown();
    await getCache().disconnect();
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000); // force exit
  } catch (e) {
    logger.error({ e: e.message }, 'Shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException',  (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception');
  // Don't exit — let watchdog handle recovery
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled rejection');
});

// ── Boot ─────────────────────────────────────────────────────────────

server.listen(PORT, async () => {
  logger.info({ port: PORT, node: process.version }, '🚀 PSX Market Engine started');

  // Start scraper orchestrator
  try {
    await getOrchestrator().start();
    logger.info('Scraper orchestrator online');
  } catch (err) {
    logger.error({ err: err.message }, 'Scraper start failed');
  }

  // Start watchdog
  getWatchdog().start();

  // Warm up cache
  getCache(); // lazy connect

  logger.info(`  REST API: http://localhost:${PORT}/api`);
  logger.info(`  WebSocket: ws://localhost:${PORT}`);
  logger.info(`  Health:   http://localhost:${PORT}/api/health`);
});

module.exports = { app, server };
