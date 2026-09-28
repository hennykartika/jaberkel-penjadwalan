'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('../db');
const { signToken } = require('../lib/token');
const { HttpError, asyncHandler } = require('../lib/http');

const router = express.Router();

const MAX_USERNAME_LENGTH = 50; // users.username is VARCHAR(50)
const MAX_PASSWORD_LENGTH = 128;

// Compared against when the username does not exist, so a missing user takes
// as long to reject as a wrong password and usernames cannot be probed by timing.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

// Failed attempts only; a successful login does not use up the quota.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many failed sign-in attempts. Try again in 15 minutes.' },
});

const invalidCredentials = () => new HttpError(401, 'Invalid username or password.');

// POST /v1/auth/login  { username, password } -> { token, user }
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    throw new HttpError(400, 'Username and password are required.');
  }
  if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw invalidCredentials();
  }

  const [rows] = await pool.execute(
    'SELECT id, username, password_hash, full_name, role FROM users WHERE username = ?',
    [username.trim()],
  );
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordMatches) {
    throw invalidCredentials();
  }

  res.json({
    success: true,
    message: 'Signed in.',
    data: {
      token: signToken(user),
      user: { username: user.username, name: user.full_name, role: user.role },
    },
  });
}));

module.exports = router;
