'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

// Pin the algorithm on both sides so a token can never pick its own.
const ALGORITHM = 'HS256';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.full_name },
    config.jwt.secret,
    { algorithm: ALGORITHM, expiresIn: config.jwt.expiresIn },
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, { algorithms: [ALGORITHM] });
}

module.exports = { signToken, verifyToken };
