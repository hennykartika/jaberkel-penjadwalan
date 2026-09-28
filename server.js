'use strict';

let config;
try {
  config = require('./config');
} catch (err) {
  console.error(err.message);
  console.error('Copy .env.example to .env and fill in the values. See README.md.');
  process.exit(1);
}

const { createApp } = require('./app');
const { pool } = require('./db');

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`Cannot connect to MySQL database "${config.db.database}" at ${config.db.host}:${config.db.port}: ${err.message}`);
    console.error('Make sure MySQL is running and schema.sql has been imported.');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const server = createApp().listen(config.port, () => {
    console.log(`Jaberkel schedule service listening on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start();
