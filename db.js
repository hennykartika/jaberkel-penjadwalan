// db.js — Connection pool ke MySQL (phpMyAdmin/XAMPP)
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_jaberkel',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Kembalikan kolom TIME/DATETIME sebagai string ("08:00:00"),
  // bukan objek Date, supaya jam tampil apa adanya di frontend.
  dateStrings: true,
});

// Cek koneksi sekali saat start agar error DB ketahuan lebih awal.
pool.getConnection()
  .then((conn) => {
    console.log('✓ Terhubung ke MySQL database "' + (process.env.DB_NAME || 'db_jaberkel') + '"');
    conn.release();
  })
  .catch((err) => {
    console.error('✗ Gagal terhubung ke MySQL:', err.message);
    console.error('  Pastikan MySQL aktif dan database sudah diimpor dari schema.sql.');
  });

module.exports = pool;
