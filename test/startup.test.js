'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const VALID_SECRET = 'a-valid-secret-with-at-least-32-characters';

function startServer(overrides) {
  return spawnSync(process.execPath, [SERVER], {
    // Explicit values take precedence over a local .env file.
    env: { ...process.env, DB_USER: 'test', PORT: '39999', ...overrides },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('refuses to start without JWT_SECRET', () => {
  const result = startServer({ JWT_SECRET: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_SECRET is required/);
});

test('refuses to start with a short JWT_SECRET', () => {
  const result = startServer({ JWT_SECRET: 'dev-secret' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_SECRET must be at least 32 characters/);
});

test('refuses to start without DB_USER', () => {
  const result = startServer({ JWT_SECRET: VALID_SECRET, DB_USER: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DB_USER is required/);
});

test('refuses to start with an invalid JWT_EXPIRES_IN', () => {
  const result = startServer({ JWT_SECRET: VALID_SECRET, JWT_EXPIRES_IN: 'forever' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_EXPIRES_IN/);
});

test('refuses to start when the database is unreachable', () => {
  const result = startServer({ JWT_SECRET: VALID_SECRET, DB_HOST: '127.0.0.1', DB_PORT: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot connect to MySQL/);
});
