-- =====================================================================
--  Sistem Jaberkel — Modul Penjadwalan (Schedule Service)
--  Henny Kartika · 6026252017
--
--  Catatan: Jaberkel adalah bimbingan belajar ONLINE, sehingga tidak ada
--  "ruangan" fisik. Lokasi kelas digantikan oleh "meeting_link" (link Zoom/
--  Google Meet) tempat siswa & guru bergabung.
--
--  Cara pakai:
--  1. Buka phpMyAdmin (XAMPP/Laragon)
--  2. Tab "Import" -> pilih file ini -> Go
--  Database "db_jaberkel" beserta tabel & data contoh akan terbentuk otomatis.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `db_jaberkel`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `db_jaberkel`;

-- ---------------------------------------------------------------------
-- Tabel users — untuk login & kontrol akses (Auth Service / FR-SCH-01)
--   role 'admin'  : boleh tambah / ubah / hapus / publikasi jadwal
--   role 'viewer' : hanya boleh melihat jadwal (siswa & guru)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `username`      VARCHAR(50)  NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name`     VARCHAR(100) NOT NULL,
  `role`          ENUM('admin','viewer') NOT NULL DEFAULT 'viewer',
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password sudah di-hash dengan bcrypt.
--   admin / admin123   (role admin)
--   siswa / siswa123   (role viewer)
INSERT INTO `users` (`username`, `password_hash`, `full_name`, `role`) VALUES
('admin', '$2b$10$1yQlWe2PfedhaG6efNNFo.t2bkhF9F242FBA.HtLjeQ5DdQ/BQ9RK', 'Admin Jaberkel', 'admin'),
('siswa', '$2b$10$DgX1ybPxcbOptDmKoP2pze8PwD6eZtxFoJ.xManWyO8GLQydc/OMm', 'Andi Ramadhan', 'viewer');

-- ---------------------------------------------------------------------
-- Tabel schedules — entitas inti modul Penjadwalan (bimbel ONLINE)
--   meeting_link menggantikan "ruangan": tautan kelas daring.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `schedules`;
CREATE TABLE `schedules` (
  `id`           INT AUTO_INCREMENT PRIMARY KEY,
  `subject`      VARCHAR(100) NOT NULL,
  `teacher`      VARCHAR(100) NOT NULL,
  `meeting_link` VARCHAR(255) NOT NULL,
  `day`          VARCHAR(20)  NOT NULL,
  `start_time`   TIME         NOT NULL,
  `end_time`     TIME         NOT NULL,
  `published`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data contoh (dummy) — tersebar Senin–Jumat & tidak ada yang bentrok.
INSERT INTO `schedules` (`subject`, `teacher`, `meeting_link`, `day`, `start_time`, `end_time`, `published`) VALUES
('Matematika Wajib', 'Drs. Bambang Wijaya', 'https://meet.google.com/mtk-wajib-01', 'Senin',  '07:30:00', '09:00:00', 1),
('Bahasa Inggris',   'Sarah Johnson, M.Pd', 'https://zoom.us/j/88010110',          'Senin',  '10:15:00', '12:00:00', 1),
('Fisika Dasar',     'Budi Santoso, S.Si',  'https://meet.google.com/fis-dasar',   'Selasa', '08:00:00', '10:00:00', 1),
('Kimia Organik',    'Dr. Sri Aminah',      'https://meet.jaberkel.id/kimia',      'Selasa', '13:00:00', '15:00:00', 0),
('Biologi',          'Bu Ani Lestari',      'https://meet.google.com/bio-kelas',   'Rabu',   '07:30:00', '09:30:00', 1),
('Sejarah Indonesia','Budi Santoso, S.Pd',  'https://zoom.us/j/77001230',          'Rabu',   '10:00:00', '11:30:00', 0),
('Ekonomi',          'Pak Rudi Hartono',    'https://meet.google.com/eko-kelas',   'Kamis',  '08:00:00', '10:00:00', 1),
('Bahasa Indonesia', 'Ibu Dewi Lestari',    'https://meet.jaberkel.id/bindo',      'Kamis',  '13:00:00', '14:30:00', 1),
('TPA / Logika',     'Coach Firman',        'https://meet.google.com/tpa-logika',  'Jumat',  '07:00:00', '08:30:00', 1),
('Seni Budaya',      'Ibu Clara',           'https://zoom.us/j/99002220',          'Jumat',  '09:00:00', '10:30:00', 0);

-- ---------------------------------------------------------------------
-- Tabel idempotency_keys — anti data ganda (duplicate request)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `idempotency_keys`;
CREATE TABLE `idempotency_keys` (
  `id_key`        VARCHAR(100) PRIMARY KEY,
  `status_code`   INT NOT NULL,
  `response_body` TEXT NOT NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
