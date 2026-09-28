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
--   admin   / admin123    (admin)
--   student / student123  (viewer)
-- Change or remove them before deploying anywhere reachable by others.
INSERT INTO `users` (`username`, `password_hash`, `full_name`, `role`) VALUES
('admin', '$2b$10$1yQlWe2PfedhaG6efNNFo.t2bkhF9F242FBA.HtLjeQ5DdQ/BQ9RK', 'Admin Jaberkel', 'admin'),
('student', '$2a$10$hfeT.5m.SNXwNrhB/Lb0KOhdA7e6ruf2AOALFH16zAFb812Pe7iRO', 'Andi Ramadhan', 'viewer');

CREATE TABLE `schedules` (
  `id`           INT AUTO_INCREMENT PRIMARY KEY,
  `subject`      VARCHAR(100) NOT NULL,
  `teacher`      VARCHAR(100) NOT NULL,
  `meeting_link` VARCHAR(255) NOT NULL,
  -- ENUM keeps invalid days out and sorts in week order.
  `day`          ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NOT NULL,
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
('Mathematics',           'Drs. Bambang Wijaya', 'https://meet.google.com/math-01',        'Monday',    '07:30:00', '09:00:00', 1),
('English',               'Sarah Johnson, M.Pd', 'https://zoom.us/j/88010110',             'Monday',    '10:15:00', '12:00:00', 1),
('Basic Physics',         'Budi Santoso, S.Si',  'https://meet.google.com/physics-basic',  'Tuesday',   '08:00:00', '10:00:00', 1),
('Organic Chemistry',     'Dr. Sri Aminah',      'https://meet.jaberkel.id/chemistry',     'Tuesday',   '13:00:00', '15:00:00', 0),
('Biology',               'Ms. Ani Lestari',     'https://meet.google.com/biology-class',  'Wednesday', '07:30:00', '09:30:00', 1),
('Indonesian History',    'Budi Santoso, S.Pd',  'https://zoom.us/j/77001230',             'Wednesday', '10:00:00', '11:30:00', 0),
('Economics',             'Mr. Rudi Hartono',    'https://meet.google.com/economics-class','Thursday',  '08:00:00', '10:00:00', 1),
('Indonesian Language',   'Ms. Dewi Lestari',    'https://meet.jaberkel.id/indonesian',    'Thursday',  '13:00:00', '14:30:00', 1),
('Aptitude Test / Logic', 'Coach Firman',        'https://meet.google.com/aptitude-logic', 'Friday',    '07:00:00', '08:30:00', 1),
('Arts and Culture',      'Ms. Clara',           'https://zoom.us/j/99002220',             'Friday',    '09:00:00', '10:30:00', 0);

-- Stores the response of a POST sent with an Idempotency-Key header so a
-- retried request returns the same result instead of creating a duplicate.
CREATE TABLE `idempotency_keys` (
  `id_key`        VARCHAR(100) NOT NULL PRIMARY KEY,
  `status_code`   SMALLINT     NOT NULL,
  `response_body` TEXT         NOT NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
