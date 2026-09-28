'use strict';

require('dotenv').config({ quiet: true });

const MIN_JWT_SECRET_LENGTH = 32;
const JWT_EXPIRES_IN_PATTERN = /^[1-9]\d*[smhd]$/;

function readConfig(env) {
  const problems = [];

  const required = (name) => {
    const value = env[name];
    if (value === undefined || value.trim() === '') {
      problems.push(`${name} is required`);
      return '';
    }
    return value.trim();
  };

  const integer = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  const list = (name) =>
    (env[name] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long`);
  }

  // Checked here because an invalid value would otherwise only fail on the first login.
  const jwtExpiresIn = (env.JWT_EXPIRES_IN || '8h').trim();
  if (!JWT_EXPIRES_IN_PATTERN.test(jwtExpiresIn)) {
    problems.push('JWT_EXPIRES_IN must look like 30m, 8h or 7d');
  }

  const config = {
    env: env.NODE_ENV || 'development',
    port: integer('PORT', 3000, { min: 1, max: 65535 }),
    trustProxy: integer('TRUST_PROXY', 0, { min: 0, max: 10 }),
    corsOrigins: Object.freeze(list('CORS_ORIGIN')),
    db: Object.freeze({
      host: env.DB_HOST || '127.0.0.1',
      port: integer('DB_PORT', 3306, { min: 1, max: 65535 }),
      user: required('DB_USER'),
      // An empty password is valid for a local XAMPP/Laragon root account.
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'db_jaberkel',
      connectionLimit: integer('DB_CONNECTION_LIMIT', 10, { min: 1, max: 100 }),
    }),
    jwt: Object.freeze({
      secret: jwtSecret,
      expiresIn: jwtExpiresIn,
    }),
  };

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }

  return Object.freeze(config);
}

// Loaded once at require time so a bad environment stops the process before
// anything else is wired up.
module.exports = readConfig(process.env);
