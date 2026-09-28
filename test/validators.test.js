'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSchedule,
  normalizeTime,
  parseId,
  parseSearchTerm,
  escapeLike,
  isValidIdempotencyKey,
} = require('../validators/schedule');

const validBody = () => ({
  subject: 'Mathematics',
  teacher: 'Mr. Budi',
  meeting_link: 'https://meet.google.com/abc-defg-hij',
  day: 'Monday',
  start_time: '08:00',
  end_time: '09:30',
});

test('accepts a valid schedule and normalizes it', () => {
  const { errors, value } = validateSchedule({ ...validBody(), subject: '  Mathematics  ' });
  assert.deepEqual(errors, []);
  assert.equal(value.subject, 'Mathematics');
  assert.equal(value.start_time, '08:00:00');
  assert.equal(value.end_time, '09:30:00');
});

test('trims names so a leading space cannot dodge the conflict check', () => {
  const { value } = validateSchedule({ ...validBody(), teacher: '  Mr. Budi' });
  assert.equal(value.teacher, 'Mr. Budi');
});

test('compares times numerically, not as raw strings', () => {
  // "10:00" >= "9:00" is false as strings, which used to let this through.
  const reversed = validateSchedule({ ...validBody(), start_time: '10:00', end_time: '9:00' });
  assert.ok(reversed.errors.includes('Start time must be earlier than end time.'));

  // "8:00" >= "10:00" is true as strings, which used to reject a valid slot.
  const valid = validateSchedule({ ...validBody(), start_time: '8:00', end_time: '10:00' });
  assert.deepEqual(valid.errors, []);
});

test('rejects malformed times', () => {
  for (const bad of ['aa', '24:00', '12:60', '12', '12:00:60', ' ', 1200]) {
    assert.equal(normalizeTime(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(normalizeTime('7:05'), '07:05:00');
  assert.equal(normalizeTime('23:59:59'), '23:59:59');
});

test('rejects empty body and reports every missing field', () => {
  const { errors } = validateSchedule(undefined);
  assert.equal(errors.length, 6);
});

test('rejects non-string fields instead of coercing them', () => {
  const { errors } = validateSchedule({ ...validBody(), subject: { $gt: '' }, teacher: ['a'] });
  assert.ok(errors.includes('Subject must be a string.'));
  assert.ok(errors.includes('Teacher must be a string.'));
});

test('enforces column lengths', () => {
  const { errors } = validateSchedule({ ...validBody(), subject: 'x'.repeat(101) });
  assert.ok(errors.includes('Subject must be at most 100 characters.'));
});

test('only accepts http and https meeting links', () => {
  for (const link of ['javascript:alert(1)', 'ftp://example.com', 'meet.google.com/abc', 'https://']) {
    const { errors } = validateSchedule({ ...validBody(), meeting_link: link });
    assert.ok(errors.length > 0, `expected ${link} to be rejected`);
  }
});

test('accepts Monday to Saturday only', () => {
  assert.deepEqual(validateSchedule({ ...validBody(), day: 'Saturday' }).errors, []);
  assert.equal(validateSchedule({ ...validBody(), day: 'Sunday' }).errors.length, 1);
  assert.equal(validateSchedule({ ...validBody(), day: 'monday' }).errors.length, 1);
});

test('parseId accepts positive integers only', () => {
  assert.equal(parseId('42'), 42);
  for (const bad of ['0', '-1', '1abc', '1.5', '', '01', '99999999999', undefined]) {
    assert.equal(parseId(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('parseSearchTerm rejects arrays and overly long terms', () => {
  assert.equal(parseSearchTerm(undefined), '');
  assert.equal(parseSearchTerm('  fisika '), 'fisika');
  assert.equal(parseSearchTerm(['a', 'b']), null);
  assert.equal(parseSearchTerm('x'.repeat(101)), null);
});

test('escapeLike neutralizes LIKE wildcards', () => {
  assert.equal(escapeLike('100%_!'), '100!%!_!!');
});

test('isValidIdempotencyKey', () => {
  assert.ok(isValidIdempotencyKey('3f1c9e0a-5b7d-4c2e-9f8a-1b2c3d4e5f60'));
  assert.ok(!isValidIdempotencyKey(''));
  assert.ok(!isValidIdempotencyKey('k'.repeat(101)));
  assert.ok(!isValidIdempotencyKey('has space'));
});
