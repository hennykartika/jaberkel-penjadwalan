'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { checkConflict } = require('../services/checkConflict');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { HttpError, asyncHandler } = require('../lib/http');
const {
  validateSchedule,
  parseId,
  parseSearchTerm,
  escapeLike,
  isValidIdempotencyKey,
} = require('../validators/schedule');

const router = express.Router();

const COLUMNS = 'id, subject, teacher, meeting_link, `day`, start_time, end_time, published';

const isAdmin = (user) => user.role === 'admin';

function requireId(raw) {
  const id = parseId(raw);
  if (id === null) throw new HttpError(400, 'ID jadwal tidak valid.');
  return id;
}

function requireValidSchedule(body) {
  const { errors, value } = validateSchedule(body);
  if (errors.length > 0) throw new HttpError(400, 'Validasi gagal.', { errors });
  return value;
}

function readIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return null;
  if (!isValidIdempotencyKey(key)) {
    throw new HttpError(400, 'Idempotency-Key harus 1-100 karakter: huruf, angka, titik, titik dua, _ atau -.');
  }
  return key;
}

async function assertNoConflict(conn, slot, excludeId = null) {
  const { conflict, conflicting_schedules } = await checkConflict(conn, { ...slot, excludeId });
  if (conflict) {
    throw new HttpError(
      409,
      'Jadwal bentrok dengan sesi lain (guru atau link kelas yang sama pada waktu yang sama).',
      { conflicting_schedules },
    );
  }
}

/**
 * Claims the key by inserting a placeholder row. A concurrent request with the
 * same key blocks on the primary key until this transaction ends, then gets
 * ER_DUP_ENTRY. Returns false when the key was already used.
 */
async function reserveIdempotencyKey(conn, key) {
  try {
    await conn.execute(
      'INSERT INTO idempotency_keys (id_key, status_code, response_body) VALUES (?, 0, ?)',
      [key, '{}'],
    );
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

async function replayStoredResponse(res, key) {
  const [rows] = await pool.execute(
    'SELECT status_code, response_body FROM idempotency_keys WHERE id_key = ?',
    [key],
  );
  if (rows.length === 0) {
    throw new HttpError(409, 'Request dengan Idempotency-Key ini sedang diproses. Silakan coba lagi.');
  }
  const body = JSON.parse(rows[0].response_body);
  return res.status(rows[0].status_code).json({ ...body, replayed: true });
}

// Every schedule endpoint requires a logged-in user.
router.use(authenticate);

// GET /v1/schedules?q=  Viewers only see published schedules.
router.get('/', asyncHandler(async (req, res) => {
  const term = parseSearchTerm(req.query.q);
  if (term === null) throw new HttpError(400, 'Parameter pencarian (q) tidak valid.');

  const conditions = [];
  const params = [];
  if (!isAdmin(req.user)) {
    conditions.push('published = 1');
  }
  if (term) {
    conditions.push("(subject LIKE ? ESCAPE '!' OR teacher LIKE ? ESCAPE '!')");
    const pattern = `%${escapeLike(term)}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // `day` is an ENUM, so it sorts in declaration order (Senin..Sabtu).
  const [rows] = await pool.execute(
    `SELECT ${COLUMNS} FROM schedules ${where} ORDER BY \`day\`, start_time`,
    params,
  );
  res.json({ success: true, count: rows.length, data: rows });
}));

// GET /v1/schedules/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = requireId(req.params.id);
  const visibility = isAdmin(req.user) ? '' : ' AND published = 1';
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM schedules WHERE id = ?${visibility}`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'Jadwal tidak ditemukan.');
  res.json({ success: true, data: rows[0] });
}));

// POST /v1/schedules
// Orchestration: validate -> idempotency -> CheckConflict -> insert, all but
// validation inside one transaction so the conflict check and the insert are atomic.
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const schedule = requireValidSchedule(req.body);
  const idempotencyKey = readIdempotencyKey(req);

  const outcome = await withTransaction(async (conn) => {
    if (idempotencyKey && !(await reserveIdempotencyKey(conn, idempotencyKey))) {
      return { replay: true };
    }

    await assertNoConflict(conn, schedule);

    const [result] = await conn.execute(
      'INSERT INTO schedules (subject, teacher, meeting_link, `day`, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
      [schedule.subject, schedule.teacher, schedule.meeting_link, schedule.day, schedule.start_time, schedule.end_time],
    );

    const body = {
      success: true,
      message: 'Jadwal berhasil ditambahkan.',
      data: { id: result.insertId, ...schedule, published: 0 },
    };

    if (idempotencyKey) {
      await conn.execute(
        'UPDATE idempotency_keys SET status_code = ?, response_body = ? WHERE id_key = ?',
        [201, JSON.stringify(body), idempotencyKey],
      );
    }

    return { body };
  });

  if (outcome.replay) {
    return replayStoredResponse(res, idempotencyKey);
  }
  return res.status(201).json(outcome.body);
}));

// PUT /v1/schedules/:id
router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = requireId(req.params.id);
  const schedule = requireValidSchedule(req.body);

  const data = await withTransaction(async (conn) => {
    const [existing] = await conn.execute('SELECT published FROM schedules WHERE id = ? FOR UPDATE', [id]);
    if (existing.length === 0) throw new HttpError(404, 'Jadwal tidak ditemukan.');

    await assertNoConflict(conn, schedule, id);

    await conn.execute(
      'UPDATE schedules SET subject = ?, teacher = ?, meeting_link = ?, `day` = ?, start_time = ?, end_time = ? WHERE id = ?',
      [schedule.subject, schedule.teacher, schedule.meeting_link, schedule.day, schedule.start_time, schedule.end_time, id],
    );

    return { id, ...schedule, published: existing[0].published };
  });

  res.json({ success: true, message: 'Jadwal berhasil diperbarui.', data });
}));

// DELETE /v1/schedules/:id
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = requireId(req.params.id);
  const [result] = await pool.execute('DELETE FROM schedules WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Jadwal tidak ditemukan.');
  res.json({ success: true, message: 'Jadwal berhasil dihapus.' });
}));

// PUT /v1/schedules/:id/publish
router.put('/:id/publish', requireAdmin, asyncHandler(async (req, res) => {
  const id = requireId(req.params.id);
  const [result] = await pool.execute('UPDATE schedules SET published = 1 WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Jadwal tidak ditemukan.');
  res.json({ success: true, message: 'Jadwal berhasil dipublikasikan.' });
}));

module.exports = router;
