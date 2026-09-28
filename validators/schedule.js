'use strict';

// Must match the ENUM on schedules.day and the <select> in public/index.html.
const DAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

// Column sizes from schema.sql. Checking them here turns a DB error into a 400.
const MAX_LENGTH = Object.freeze({ subject: 100, teacher: 100, meeting_link: 255 });

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const ID_PATTERN = /^[1-9]\d{0,9}$/;
const MAX_ID = 2147483647; // INT upper bound
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_SEARCH_LENGTH = 100;

/**
 * Accepts H:MM, HH:MM and HH:MM:SS and returns zero-padded HH:MM:SS, or null.
 * The padding is what makes string comparison safe: "9:00" > "10:00" as raw strings.
 */
function normalizeTime(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds = '00'] = match;
  return `${hours.padStart(2, '0')}:${minutes}:${seconds}`;
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function readText(body, field, label, errors) {
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    errors.push(`${label} must be a string.`);
    return '';
  }
  const value = (raw || '').trim();
  if (!value) {
    errors.push(`${label} is required.`);
  } else if (value.length > MAX_LENGTH[field]) {
    errors.push(`${label} must be at most ${MAX_LENGTH[field]} characters.`);
  }
  return value;
}

function readTime(body, field, label, errors) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    errors.push(`${label} is required.`);
    return null;
  }
  const value = normalizeTime(raw);
  if (!value) {
    errors.push(`${label} must use the HH:MM or HH:MM:SS format.`);
  }
  return value;
}

/**
 * Validates a schedule payload for POST and PUT.
 * Returns the trimmed, normalized values so the handler never stores raw input.
 */
function validateSchedule(body) {
  const input = body !== null && typeof body === 'object' ? body : {};
  const errors = [];

  const subject = readText(input, 'subject', 'Subject', errors);
  const teacher = readText(input, 'teacher', 'Teacher', errors);
  const meetingLink = readText(input, 'meeting_link', 'Meeting link', errors);
  if (meetingLink && meetingLink.length <= MAX_LENGTH.meeting_link && !isHttpUrl(meetingLink)) {
    errors.push('Meeting link must be a valid URL starting with http:// or https://.');
  }

  const day = typeof input.day === 'string' ? input.day.trim() : '';
  if (!DAYS.includes(day)) {
    errors.push(`Day must be one of: ${DAYS.join(', ')}.`);
  }

  const startTime = readTime(input, 'start_time', 'Start time', errors);
  const endTime = readTime(input, 'end_time', 'End time', errors);
  // Safe to compare as strings because both are zero-padded HH:MM:SS.
  if (startTime && endTime && startTime >= endTime) {
    errors.push('Start time must be earlier than end time.');
  }

  return {
    errors,
    value: {
      subject,
      teacher,
      meeting_link: meetingLink,
      day,
      start_time: startTime,
      end_time: endTime,
    },
  };
}

/** Returns a positive INT id, or null. Rejects "1abc", which MySQL would cast to 1. */
function parseId(raw) {
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_ID ? id : null;
}

/** Returns '' when absent, the trimmed term when valid, or null when invalid. */
function parseSearchTerm(raw) {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') return null; // ?q=a&q=b arrives as an array
  const term = raw.trim();
  return term.length <= MAX_SEARCH_LENGTH ? term : null;
}

/** Escapes LIKE wildcards so "%" and "_" are matched literally. Use with ESCAPE '!'. */
function escapeLike(term) {
  return term.replace(/[!%_]/g, '!$&');
}

function isValidIdempotencyKey(key) {
  return typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key);
}

module.exports = {
  DAYS,
  validateSchedule,
  normalizeTime,
  parseId,
  parseSearchTerm,
  escapeLike,
  isValidIdempotencyKey,
};
