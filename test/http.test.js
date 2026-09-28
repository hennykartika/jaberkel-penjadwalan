'use strict';

// HTTP-level tests that do not need a database. Nothing listens on DB_PORT=1,
// so any request that reaches MySQL fails fast with ECONNREFUSED.
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-0123456789';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.DB_USER = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { pool } = require('../db');
const { signToken } = require('../lib/token');

let server;
let baseUrl;

const adminToken = signToken({ id: 1, username: 'admin', role: 'admin', full_name: 'Admin' });
const viewerToken = signToken({ id: 2, username: 'siswa', role: 'viewer', full_name: 'Siswa' });

async function request(path, { method = 'GET', token, body, rawBody, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || rawBody !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = rawBody ?? JSON.stringify(body);
  }
  const res = await fetch(baseUrl + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave json null for non-JSON responses
  }
  return { status: res.status, headers: res.headers, text, json };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('health check responds with security headers and no framework banner', async () => {
  const res = await request('/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS is off by default', async () => {
  const res = await request('/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('rejects requests without a token', async () => {
  const res = await request('/v1/schedules');
  assert.equal(res.status, 401);
  assert.equal(res.json.success, false);
});

test('rejects a token signed with the old "dev-secret" fallback', async () => {
  const forged = jwt.sign({ id: 999, username: 'x', role: 'admin', name: 'x' }, 'dev-secret');
  const res = await request('/v1/schedules', { token: forged });
  assert.equal(res.status, 401);
});

test('rejects an unsigned token (alg: none)', async () => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ id: 1, role: 'admin' })}.`;
  const res = await request('/v1/schedules', { token: unsigned });
  assert.equal(res.status, 401);
});

test('viewer cannot create, update, delete or publish', async () => {
  const attempts = [
    ['POST', '/v1/schedules'],
    ['PUT', '/v1/schedules/1'],
    ['DELETE', '/v1/schedules/1'],
    ['PUT', '/v1/schedules/1/publish'],
  ];
  for (const [method, path] of attempts) {
    const res = await request(path, { method, token: viewerToken, body: {} });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
});

test('malformed JSON returns a JSON 400 without a stack trace', async () => {
  const res = await request('/v1/auth/login', { method: 'POST', rawBody: '{bad' });
  assert.equal(res.status, 400);
  assert.equal(res.json.success, false);
  assert.doesNotMatch(res.text, /SyntaxError|node_modules|at /);
});

test('oversized body is rejected with 413', async () => {
  const res = await request('/v1/auth/login', {
    method: 'POST',
    body: { username: 'a', password: 'x'.repeat(20 * 1024) },
  });
  assert.equal(res.status, 413);
});

test('invalid schedule payload is rejected before touching the database', async () => {
  const res = await request('/v1/schedules', {
    method: 'POST',
    token: adminToken,
    body: { subject: '', start_time: '10:00', end_time: '09:00' },
  });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.json.errors));
});

test('non-numeric id is rejected instead of being cast by MySQL', async () => {
  const res = await request('/v1/schedules/1abc', { token: adminToken });
  assert.equal(res.status, 400);
});

test('array query parameter is rejected', async () => {
  const res = await request('/v1/schedules?q=a&q=b', { token: adminToken });
  assert.equal(res.status, 400);
});

test('invalid Idempotency-Key is rejected', async () => {
  const res = await request('/v1/schedules', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': 'k'.repeat(101) },
    body: {
      subject: 'A',
      teacher: 'B',
      meeting_link: 'https://meet.example/a',
      day: 'Senin',
      start_time: '08:00',
      end_time: '09:00',
    },
  });
  assert.equal(res.status, 400);
});

test('unknown API route returns JSON 404', async () => {
  const res = await request('/v1/does-not-exist', { token: adminToken });
  assert.equal(res.status, 404);
  assert.equal(res.json.success, false);
});

test('database failure returns a generic 500 and the process keeps serving', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  const res = await request('/v1/schedules', { token: adminToken });
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { success: false, message: 'Terjadi kesalahan pada server.' });
  assert.doesNotMatch(res.text, /ECONNREFUSED|127\.0\.0\.1/);
  assert.equal(logged.mock.callCount(), 1, 'the real error is logged server-side');

  const health = await request('/health');
  assert.equal(health.status, 200);
});

// Runs last: it exhausts the login rate limit for this process.
test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await request('/v1/auth/login', { method: 'POST', body: { username: 'admin' } });
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.success, false);
});
