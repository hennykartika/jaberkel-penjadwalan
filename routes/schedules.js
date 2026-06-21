// routes/schedules.js — Schedule Service (Entity Service).
// Endpoint mengikuti Service Routing Table Tugas 12/13.
// Jaberkel = bimbel ONLINE: field "meeting_link" menggantikan "ruangan".
const express = require('express');
const pool = require('../db');
const { checkConflict } = require('../services/checkConflict');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

// --- Validasi input (dipakai POST & PUT) ---------------------------------
function validateSchedule(b = {}) {
  const errors = [];
  if (!b.subject || !String(b.subject).trim()) errors.push('Mata pelajaran (subject) wajib diisi.');
  if (!b.teacher || !String(b.teacher).trim()) errors.push('Guru (teacher) wajib diisi.');
  if (!b.meeting_link || !String(b.meeting_link).trim()) {
    errors.push('Link kelas online (meeting_link) wajib diisi.');
  } else if (!/^https?:\/\/.+/i.test(String(b.meeting_link).trim())) {
    errors.push('Link kelas harus berupa URL yang valid (diawali http:// atau https://).');
  }
  if (!b.day || !DAYS.includes(b.day)) errors.push('Hari (day) harus salah satu dari: ' + DAYS.join(', ') + '.');
  if (!b.start_time) errors.push('Jam mulai (start_time) wajib diisi.');
  if (!b.end_time) errors.push('Jam selesai (end_time) wajib diisi.');
  if (b.start_time && b.end_time && b.start_time >= b.end_time) {
    errors.push('Jam mulai harus lebih awal dari jam selesai.');
  }
  return errors;
}

// --- GET semua jadwal (dukung pencarian ?q=) -----------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let sql = 'SELECT * FROM schedules';
    const params = [];
    if (q) {
      sql += ' WHERE subject LIKE ? OR teacher LIKE ?';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY FIELD(`day`,"Senin","Selasa","Rabu","Kamis","Jumat","Sabtu","Minggu"), start_time';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data jadwal.', error: err.message });
  }
});

// --- GET satu jadwal -----------------------------------------------------
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil jadwal.', error: err.message });
  }
});

// --- POST tambah jadwal (admin) ------------------------------------------
// Orkestrasi: validasi -> cek idempotency -> CheckConflict -> simpan dalam transaction.
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const errors = validateSchedule(req.body);
  if (errors.length) return res.status(400).json({ success: false, message: 'Validasi gagal.', errors });

  const { subject, teacher, meeting_link, day, start_time, end_time } = req.body;

  // (1) Anti duplicate request — replay hasil bila key sudah pernah diproses.
  const idemKey = req.header('Idempotency-Key');
  if (idemKey) {
    const [seen] = await pool.query(
      'SELECT status_code, response_body FROM idempotency_keys WHERE id_key = ?', [idemKey]);
    if (seen.length) {
      const body = JSON.parse(seen[0].response_body);
      return res.status(seen[0].status_code).json({ ...body, replayed: true });
    }
  }

  // (2) Panggil underlying service: CheckConflict.
  const { conflict, conflicting_schedules } = await checkConflict({ teacher, meeting_link, day, start_time, end_time });
  if (conflict) {
    return res.status(409).json({
      success: false,
      message: 'Jadwal bentrok dengan sesi lain (guru atau link kelas yang sama pada waktu yang sama).',
      conflicting_schedules,
    });
  }

  // (3) Anti inconsistency — simpan dalam transaction (commit/rollback).
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO schedules (subject, teacher, meeting_link, `day`, start_time, end_time) VALUES (?,?,?,?,?,?)',
      [subject, teacher, meeting_link, day, start_time, end_time]
    );
    const body = {
      success: true,
      message: 'Jadwal berhasil ditambahkan.',
      data: { id: result.insertId, subject, teacher, meeting_link, day, start_time, end_time, published: 0 },
    };
    if (idemKey) {
      await conn.query(
        'INSERT INTO idempotency_keys (id_key, status_code, response_body) VALUES (?,?,?)',
        [idemKey, 201, JSON.stringify(body)]
      );
    }
    await conn.commit();
    res.status(201).json(body);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Gagal menyimpan jadwal (rollback).', error: err.message });
  } finally {
    conn.release();
  }
});

// --- PUT ubah jadwal (admin) ---------------------------------------------
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const errors = validateSchedule(req.body);
  if (errors.length) return res.status(400).json({ success: false, message: 'Validasi gagal.', errors });

  const { subject, teacher, meeting_link, day, start_time, end_time } = req.body;
  try {
    const [exists] = await pool.query('SELECT id FROM schedules WHERE id = ?', [req.params.id]);
    if (!exists.length) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });

    const { conflict, conflicting_schedules } = await checkConflict({
      teacher, meeting_link, day, start_time, end_time, excludeId: req.params.id,
    });
    if (conflict) {
      return res.status(409).json({ success: false, message: 'Jadwal bentrok.', conflicting_schedules });
    }

    await pool.query(
      'UPDATE schedules SET subject=?, teacher=?, meeting_link=?, `day`=?, start_time=?, end_time=? WHERE id=?',
      [subject, teacher, meeting_link, day, start_time, end_time, req.params.id]
    );
    res.json({ success: true, message: 'Jadwal berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui jadwal.', error: err.message });
  }
});

// --- DELETE hapus jadwal (admin) -----------------------------------------
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
    res.json({ success: true, message: 'Jadwal berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus jadwal.', error: err.message });
  }
});

// --- PUT publikasikan jadwal (admin) -------------------------------------
router.put('/:id/publish', authenticate, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('UPDATE schedules SET published = 1 WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
    res.json({ success: true, message: 'Jadwal berhasil dipublikasikan.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mempublikasikan jadwal.', error: err.message });
  }
});

module.exports = router;
