'use strict';

const { verifyToken } = require('../lib/token');

const BEARER_PATTERN = /^Bearer ([^\s]+)$/;

function authenticate(req, res, next) {
  const match = BEARER_PATTERN.exec(req.get('Authorization') || '');
  if (!match) {
    return res.status(401).json({
      success: false,
      message: 'Belum login. Sertakan token pada header Authorization.',
    });
  }

  try {
    const { id, username, role, name } = verifyToken(match[1]);
    req.user = { id, username, role, name };
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang.',
    });
  }
}

// FR-SCH-01: only admins may create, change, delete or publish schedules.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak. Hanya admin yang boleh mengubah jadwal.',
    });
  }
  return next();
}

module.exports = { authenticate, requireAdmin };
