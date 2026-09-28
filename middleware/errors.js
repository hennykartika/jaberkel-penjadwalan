'use strict';

const { HttpError } = require('../lib/http');

function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
}

// Body-parser failures are client errors; map them to a short message instead
// of letting Express render its default HTML page with a stack trace.
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': [400, 'Body request bukan JSON yang valid.'],
  'entity.too.large': [413, 'Body request terlalu besar.'],
  'encoding.unsupported': [415, 'Encoding body request tidak didukung.'],
  'charset.unsupported': [415, 'Charset body request tidak didukung.'],
};

// Lock contention that survived the retries in withTransaction().
const CONCURRENCY_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

function errorHandler(err, req, res, next) {
  // Too late to send a JSON body; let Express close the connection.
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, ...err.details });
  }

  const bodyParserError = BODY_PARSER_ERRORS[err.type];
  if (bodyParserError) {
    const [status, message] = bodyParserError;
    return res.status(status).json({ success: false, message });
  }

  if (CONCURRENCY_ERRORS.has(err.code)) {
    return res.status(409).json({
      success: false,
      message: 'Jadwal sedang diubah oleh request lain. Silakan coba lagi.',
    });
  }

  // Full details stay in the server log; the client only gets a generic message.
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} failed:`, err);
  return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
}

module.exports = { notFound, errorHandler };
