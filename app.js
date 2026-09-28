'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const authRoutes = require('./routes/auth');
const scheduleRoutes = require('./routes/schedules');
const { notFound, errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();

  if (config.trustProxy > 0) {
    // Needed behind a reverse proxy so the login rate limit sees the client IP.
    app.set('trust proxy', config.trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          // Local setups serve plain HTTP; upgrading asset requests would break them.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );

  // The frontend is served from this same origin, so CORS stays off unless a
  // separate client origin is configured explicitly.
  if (config.corsOrigins.length > 0) {
    app.use('/v1', cors({ origin: config.corsOrigins }));
  }

  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (req, res) => {
    res.json({ success: true, service: 'Jaberkel Schedule Service', status: 'OK' });
  });

  app.use('/v1/auth', authRoutes);
  app.use('/v1/schedules', scheduleRoutes);
  app.use('/v1', notFound);

  app.use(express.static(path.join(__dirname, 'public')));

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
