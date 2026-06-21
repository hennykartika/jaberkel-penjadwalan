// middleware/auth.js — Auth Service (Utility) sebagai middleware Express.
// Memvalidasi token JWT dan menegakkan FR-SCH-01: hanya admin yang boleh
// menambah / mengubah / menghapus jadwal.
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

// Memastikan request membawa token yang sah pada header Authorization.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Belum login. Sertakan token pada header Authorization.',
    });
  }
  try {
    req.user = jwt.verify(token, SECRET); // { id, username, role, name }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang.',
    });
  }
}

// Hanya meneruskan request bila pengguna ber-role admin.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak. Hanya admin yang boleh mengubah jadwal.',
    });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
