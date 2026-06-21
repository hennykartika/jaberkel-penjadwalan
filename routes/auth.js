// routes/auth.js — Auth Service: endpoint login menghasilkan token JWT.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'dev-secret';

// POST /v1/auth/login  { username, password } -> { token, user }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const user = rows[0];
    const cocok = await bcrypt.compare(password, user.password_hash);
    if (!cocok) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.full_name },
      SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      message: 'Login berhasil.',
      data: {
        token,
        user: { username: user.username, name: user.full_name, role: user.role },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Kesalahan server saat login.', error: err.message });
  }
});

module.exports = router;
