-- Jaberkel schedule service: database schema and demo data.
--
-- Import through phpMyAdmin (Import tab) or the CLI:
--   mysql -u root -p < schema.sql
--
-- WARNING: this script drops and recreates every table, so all existing
-- data in db_jaberkel is lost. Use it for local setup only.
--
-- Jaberkel runs its classes online, so a schedule has a meeting_link
-- (Zoom / Google Meet URL) instead of a room.

CREATE DATABASE IF NOT EXISTS `db_jaberkel`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `db_jaberkel`;

DROP TABLE IF EXISTS `idempotency_keys`;
DROP TABLE IF EXISTS `schedules`;
DROP TABLE IF EXISTS `users`;

-- role 'admin' may create, update, delete and publish schedules.
-- role 'viewer' (students and teachers) may only read published schedules.
CREATE TABLE `users` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `username`      VARCHAR(50)  NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name`     VARCHAR(100) NOT NULL,
  `role`          ENUM('admin','viewer') NOT NULL DEFAULT 'viewer',
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demo accounts for local testing only (bcrypt, cost 10):
--   admin / admin123  (admin)
--   siswa / siswa123  (viewer)
-- Change or remove them before deploying anywhere reachable by others.
INSERT INTO `users` (`username`, `password_hash`, `full_name`, `role`) VALUES
('admin', '$2b$10$1yQlWe2PfedhaG6efNNFo.t2bkhF9F242FBA.HtLjeQ5DdQ/BQ9RK', 'Admin Jaberkel', 'admin'),
('siswa', '$2b$10$DgX1ybPxcbOptDmKoP2pze8PwD6eZtxFoJ.xManWyO8GLQydc/OMm', 'Andi Ramadhan', 'viewer');

CREATE TABLE `schedules` (
  `id`           INT AUTO_INCREMENT PRIMARY KEY,
  `subject`      VARCHAR(100) NOT NULL,
  `teacher`      VARCHAR(100) NOT NULL,
  `meeting_link` VARCHAR(255) NOT NULL,
  -- ENUM keeps invalid days out and sorts in week order.
  `day`          ENUM('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu') NOT NULL,
  `start_time`   TIME         NOT NULL,
  `end_time`     TIME         NOT NULL,
  `published`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `chk_schedules_time_range` CHECK (`end_time` > `start_time`),
  -- Serves the conflict check (day + time range) and the list ordering.
  KEY `idx_schedules_day_start` (`day`, `start_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demo data spread over Monday to Friday, with no conflicts.
INSERT INTO `schedules` (`subject`, `teacher`, `meeting_link`, `day`, `start_time`, `end_time`, `published`) VALUES
('Matematika Wajib',  'Drs. Bambang Wijaya', 'https://meet.google.com/mtk-wajib-01', 'Senin',  '07:30:00', '09:00:00', 1),
('Bahasa Inggris',    'Sarah Johnson, M.Pd', 'https://zoom.us/j/88010110',          'Senin',  '10:15:00', '12:00:00', 1),
('Fisika Dasar',      'Budi Santoso, S.Si',  'https://meet.google.com/fis-dasar',   'Selasa', '08:00:00', '10:00:00', 1),
('Kimia Organik',     'Dr. Sri Aminah',      'https://meet.jaberkel.id/kimia',      'Selasa', '13:00:00', '15:00:00', 0),
('Biologi',           'Bu Ani Lestari',      'https://meet.google.com/bio-kelas',   'Rabu',   '07:30:00', '09:30:00', 1),
('Sejarah Indonesia', 'Budi Santoso, S.Pd',  'https://zoom.us/j/77001230',          'Rabu',   '10:00:00', '11:30:00', 0),
('Ekonomi',           'Pak Rudi Hartono',    'https://meet.google.com/eko-kelas',   'Kamis',  '08:00:00', '10:00:00', 1),
('Bahasa Indonesia',  'Ibu Dewi Lestari',    'https://meet.jaberkel.id/bindo',      'Kamis',  '13:00:00', '14:30:00', 1),
('TPA / Logika',      'Coach Firman',        'https://meet.google.com/tpa-logika',  'Jumat',  '07:00:00', '08:30:00', 1),
('Seni Budaya',       'Ibu Clara',           'https://zoom.us/j/99002220',          'Jumat',  '09:00:00', '10:30:00', 0);

-- Stores the response of a POST sent with an Idempotency-Key header so a
-- retried request returns the same result instead of creating a duplicate.
CREATE TABLE `idempotency_keys` (
  `id_key`        VARCHAR(100) NOT NULL PRIMARY KEY,
  `status_code`   SMALLINT     NOT NULL,
  `response_body` TEXT         NOT NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
