'use strict';

// End-to-end tests against a real MySQL/MariaDB server. Skipped unless
// TEST_DB_NAME is set. The database named there is DROPPED and recreated from
// schema.sql, so never point it at a database you care about.
//
//   TEST_DB_NAME=db_jaberkel_test DB_USER=root DB_PASSWORD= npm test

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DB = process.env.TEST_DB_NAME;
const skip = TEST_DB ? false : 'set TEST_DB_NAME to run the integration tests';

describe('integration (real database)', { skip }, () => {
  let server;
  let baseUrl;
  let pool;
  let adminToken;
  let viewerToken;

  async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + pathname, init);
    return { status: res.status, body: await res.json() };
  }

  async function login(username, password) {
    const res = await api('/v1/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(res.status, 200);
    return res.body.data.token;
  }

  const slot = (overrides = {}) => ({
    subject: 'Test Session',
    teacher: 'Test Teacher',
    meeting_link: `https://meet.example/${crypto.randomUUID()}`,
    day: 'Saturday',
    start_time: '14:00',
    end_time: '15:00',
    ...overrides,
  });

  before(async () => {
    // Pick up DB credentials from .env, but never run against its DB_NAME.
    require('dotenv').config({ quiet: true });
    const appDb = process.env.DB_NAME || 'db_jaberkel';
    if (!/^[A-Za-z0-9_]+$/.test(TEST_DB) || TEST_DB === appDb || TEST_DB === 'db_jaberkel') {
      throw new Error(`TEST_DB_NAME must be a plain identifier different from ${appDb}; it gets dropped`);
    }
    process.env.DB_NAME = TEST_DB;

    const mysql = require('mysql2/promise');
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
    });
    const schema = fs
      .readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8')
      .replaceAll('`db_jaberkel`', `\`${TEST_DB}\``);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(schema);
    await admin.end();

    process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');

    const { createApp } = require('../app');
    ({ pool } = require('../db'));
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    adminToken = await login('admin', 'admin123');
    viewerToken = await login('student', 'student123');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) {
      await pool.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      await pool.end();
    }
  });

  test('wrong password and unknown user get the same response', async () => {
    const wrongPassword = await api('/v1/auth/login', { method: 'POST', body: { username: 'admin', password: 'nope' } });
    const unknownUser = await api('/v1/auth/login', { method: 'POST', body: { username: 'ghost', password: 'nope' } });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(unknownUser, wrongPassword);
  });

  test('viewer only sees published schedules', async () => {
    const list = await api('/v1/schedules', { token: viewerToken });
    assert.equal(list.status, 200);
    assert.ok(list.body.count > 0);
    assert.ok(list.body.data.every((s) => s.published === 1));

    const draft = await api('/v1/schedules/4', { token: viewerToken }); // Organic Chemistry is a draft
    assert.equal(draft.status, 404);

    const asAdmin = await api('/v1/schedules/4', { token: adminToken });
    assert.equal(asAdmin.status, 200);
  });

  test('search treats % and _ literally', async () => {
    const res = await api(`/v1/schedules?q=${encodeURIComponent('%')}`, { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 0);
  });

  // Opens every pooled connection up front. On a cold pool each request waits
  // for a new handshake, which spaces them out and hides the race.
  async function warmPool() {
    await Promise.all(Array.from({ length: 10 }, () => pool.query('SELECT SLEEP(0.05)')));
  }

  test('concurrent requests for the same slot create exactly one schedule', async () => {
    await warmPool();
    const teacher = `Parallel Teacher ${crypto.randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        api('/v1/schedules', { method: 'POST', token: adminToken, body: slot({ teacher }) })),
    );

    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(created.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(conflicts.length, 19);

    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM schedules WHERE teacher = ?', [teacher]);
    assert.equal(rows[0].n, 1);
  });

  test('concurrent retries with one Idempotency-Key insert once and replay the rest', async () => {
    await warmPool();
    const key = crypto.randomUUID();
    const body = slot({ teacher: `Idempotent Teacher ${key}`, start_time: '16:00', end_time: '17:00' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api('/v1/schedules', { method: 'POST', token: adminToken, body, headers: { 'Idempotency-Key': key } })),
    );

    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
    const ids = new Set(results.map((r) => r.body.data.id));
    assert.equal(ids.size, 1);
    assert.equal(results.filter((r) => r.body.replayed).length, 9);
  });

  test('update that would clash is rejected and leaves the row unchanged', async () => {
    // Move Mathematics (Monday 07:30-09:00) onto the English class link at 11:00.
    const res = await api('/v1/schedules/1', {
      method: 'PUT',
      token: adminToken,
      body: {
        subject: 'Mathematics',
        teacher: 'Drs. Bambang Wijaya',
        meeting_link: 'https://zoom.us/j/88010110',
        day: 'Monday',
        start_time: '11:00',
        end_time: '12:00',
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.conflicting_schedules[0].id, 2);

    const after = await api('/v1/schedules/1', { token: adminToken });
    assert.equal(after.body.data.start_time, '07:30:00');
  });

  test('update may keep its own slot', async () => {
    const res = await api('/v1/schedules/1', {
      method: 'PUT',
      token: adminToken,
      body: {
        subject: 'Mathematics',
        teacher: 'Drs. Bambang Wijaya',
        meeting_link: 'https://meet.google.com/math-01',
        day: 'Monday',
        start_time: '07:30',
        end_time: '09:15',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.end_time, '09:15:00');
  });

  test('publish and delete return 404 for missing rows', async () => {
    assert.equal((await api('/v1/schedules/99999/publish', { method: 'PUT', token: adminToken })).status, 404);
    assert.equal((await api('/v1/schedules/99999', { method: 'DELETE', token: adminToken })).status, 404);
  });
});
