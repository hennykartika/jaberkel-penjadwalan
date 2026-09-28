'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  // Return TIME columns as "HH:MM:SS" strings instead of Date objects.
  dateStrings: true,
});

const MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * Runs `work(conn)` inside a transaction and commits if it resolves.
 * Any error rolls the transaction back and is rethrown. InnoDB deadlocks are
 * retried a few times because they are an expected outcome of two requests
 * competing for the same gap lock (see services/checkConflict.js).
 */
async function withTransaction(work) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    let connectionBroken = false;

    try {
      // The conflict check relies on the gap locks InnoDB takes for
      // SELECT ... FOR UPDATE under REPEATABLE READ. READ COMMITTED does not
      // take gap locks, so pin the level instead of trusting the server default.
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        connectionBroken = true;
      }
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_TRANSACTION_ATTEMPTS) {
        continue;
      }
      throw err;
    } finally {
      if (connectionBroken) {
        conn.destroy();
      } else {
        conn.release();
      }
    }
  }
}

module.exports = { pool, withTransaction };
