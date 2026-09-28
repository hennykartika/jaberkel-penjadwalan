'use strict';

/**
 * An error that is safe to show to the client. `details` is merged into the
 * JSON body, e.g. `{ errors: [...] }` or `{ conflicting_schedules: [...] }`.
 */
class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Express 4 does not catch rejected promises from async handlers. Without this
 * wrapper a failed query becomes an unhandled rejection, which terminates the
 * Node process.
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { HttpError, asyncHandler };
