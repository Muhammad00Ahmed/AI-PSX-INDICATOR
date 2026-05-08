'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
  formatters: {
    level(label) { return { level: label }; },
  },
  base: { service: 'psx-engine' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
