// services/checkConflict.js — CheckConflict (Microservice / underlying service).
// Dipisah sebagai modul tersendiri agar memetakan langsung ke desain SOA Tugas 12/13.
//
// Jaberkel adalah bimbel ONLINE, jadi tidak ada ruangan fisik. Aturan bentrok:
// dua sesi dianggap bentrok bila berada pada HARI yang sama, memakai GURU yang
// sama ATAU LINK KELAS (meeting_link) yang sama, DAN waktunya tumpang tindih.
//   - Guru tidak bisa mengajar dua kelas online sekaligus.
//   - Satu link kelas (ruang virtual) tidak bisa dipakai dua sesi pada waktu bersamaan.
// Rumus tumpang tindih: existing.start < new.end  DAN  existing.end > new.start.
const pool = require('../db');

async function checkConflict({ teacher, meeting_link, day, start_time, end_time, excludeId = null }) {
  let sql = `
    SELECT id, subject, teacher, meeting_link, \`day\`, start_time, end_time
    FROM schedules
    WHERE \`day\` = ?
      AND (teacher = ? OR meeting_link = ?)
      AND start_time < ?
      AND end_time > ?`;
  const params = [day, teacher, meeting_link, end_time, start_time];

  // Saat mengubah jadwal, jangan anggap dirinya sendiri sebagai bentrok.
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }

  const [rows] = await pool.query(sql, params);
  return { conflict: rows.length > 0, conflicting_schedules: rows };
}

module.exports = { checkConflict };
