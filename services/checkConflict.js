'use strict';

/**
 * CheckConflict, the underlying service from the SOA design.
 *
 * Jaberkel runs its classes online, so there are no rooms. Two sessions clash
 * when they are on the same day, share the teacher or the meeting link, and
 * their times overlap:
 *
 *   existing.start_time < new.end_time AND existing.end_time > new.start_time
 *
 * Must be called with a connection that is inside a transaction. The query uses
 * SELECT ... FOR UPDATE, so InnoDB locks the scanned index range (including the
 * gaps between rows). A second request checking the same day either waits for
 * this transaction to finish and then sees its row, or hits a deadlock that
 * withTransaction() retries. Either way both requests cannot pass the check.
 */
async function checkConflict(conn, { teacher, meeting_link, day, start_time, end_time, excludeId = null }) {
  let sql = `
    SELECT id, subject, teacher, meeting_link, \`day\`, start_time, end_time
    FROM schedules
    WHERE \`day\` = ?
      AND (teacher = ? OR meeting_link = ?)
      AND start_time < ?
      AND end_time > ?`;
  const params = [day, teacher, meeting_link, end_time, start_time];

  // When updating, a schedule must not clash with itself.
  if (excludeId !== null) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }

  sql += ' FOR UPDATE';

  const [rows] = await conn.execute(sql, params);
  return { conflict: rows.length > 0, conflicting_schedules: rows };
}

module.exports = { checkConflict };
