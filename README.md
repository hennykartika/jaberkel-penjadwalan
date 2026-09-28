# Jaberkel: Modul Penjadwalan (Schedule Service)

Final Project · System Development and Implementation

Henny Kartika · 6026252017

Aplikasi penjadwalan kelas untuk Jaberkel, bimbingan belajar online. Backend berupa
REST API (Node.js, Express, MySQL) dan frontend web statis yang disajikan dari server
yang sama. Modul yang dikerjakan hanya Penjadwalan; manajemen pengguna hanya dipakai
sebatas login untuk kontrol akses.

## 1. Menjalankan secara lokal

Prasyarat: Node.js 20 atau lebih baru (disarankan versi LTS terbaru), dan MySQL/MariaDB
(XAMPP atau Laragon).

1. Impor database. Buka phpMyAdmin, tab Import, pilih `schema.sql`, lalu Go.
   Atau lewat terminal: `mysql -u root -p < schema.sql`.
   Script ini membuat database `db_jaberkel` berisi tabel `users`, `schedules`,
   `idempotency_keys` dan data contoh. Semua tabel di-drop lalu dibuat ulang, jadi
   data lama di `db_jaberkel` akan hilang.
2. Salin konfigurasi.
   ```bash
   cp .env.example .env
   ```
   Isi `JWT_SECRET` (wajib, minimal 32 karakter). Server menolak start kalau nilainya
   kosong atau terlalu pendek. Buat secret acak dengan:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   Untuk XAMPP bawaan, `DB_USER=root` dan `DB_PASSWORD` dikosongkan.
3. Pasang dependency dan jalankan.
   ```bash
   npm install
   npm start
   ```
4. Buka http://localhost:3000.

Server juga menolak start bila tidak bisa terhubung ke database, supaya salah
konfigurasi langsung kelihatan saat startup.

### Akun demo

| Username | Password   | Peran  | Hak akses                                        |
|----------|------------|--------|--------------------------------------------------|
| `admin`  | `admin123` | admin  | Lihat semua jadwal, tambah/ubah/hapus/publikasi  |
| `siswa`  | `siswa123` | viewer | Hanya melihat jadwal yang sudah dipublikasikan   |

Akun ini hanya untuk demo lokal. Ganti atau hapus sebelum aplikasi dipasang di
server yang bisa diakses orang lain.

## 2. Alasan memakai login

- Use case FR-SCH-01 (Tugas 12/13): hanya admin yang boleh menambah dan mengubah
  jadwal, sedangkan siswa dan guru hanya melihat. Aturan ini tidak bisa ditegakkan
  tanpa identitas pengguna.
- Login mengisi peran Auth Service (utility service) pada arsitektur SOA, sehingga
  arsitektur di laporan benar-benar terimplementasi.
- Memberi skenario gagal untuk pengujian: viewer yang mencoba menambah jadwal
  ditolak dengan `403 Forbidden`.

Login dibuat sederhana: satu endpoint `POST /v1/auth/login` yang mengembalikan
token JWT (berlaku 8 jam, bisa diatur lewat `JWT_EXPIRES_IN`, mis. `30m`, `8h`, `7d`).

## 3. Arsitektur SOA

```
Browser (public/)
   │  fetch + Bearer token
   ▼
Process / orchestration      routes/schedules.js
(handler POST dan PUT)       validasi → idempotency → CheckConflict → simpan
   │                                     │
   │ verifikasi token                    │ dalam satu transaksi
   ▼                                     ▼
Auth Service                 CheckConflict                 Schedule entity
middleware/auth.js           services/checkConflict.js     tabel schedules (MySQL)
lib/token.js                 cek bentrok guru/link/waktu
```

- Presentation layer: frontend `public/` (HTML/CSS/JS) yang memanggil REST API.
- Process layer: handler `POST /v1/schedules` dan `PUT /v1/schedules/:id` sebagai
  orchestrator. Validasi dilakukan di awal, lalu cek idempotency, CheckConflict dan
  penyimpanan berjalan dalam satu transaksi database.
- Service/utility layer: Auth Service (verifikasi JWT dan cek role) dan CheckConflict
  (modul terpisah yang memetakan microservice pada desain).
- Data layer: MySQL melalui connection pool (`db.js`).

### Tabel service / routing (Soal 2b)

| Method | Path                        | Deskripsi                       | Input                                                          | Return                                         |
|--------|-----------------------------|---------------------------------|----------------------------------------------------------------|------------------------------------------------|
| POST   | `/v1/auth/login`            | Login, menghasilkan token       | body: `username`, `password`                                   | `{ success, data: { token, user } }`           |
| GET    | `/v1/schedules`             | Daftar jadwal, pencarian `?q=`  | header `Authorization`; query `q`                              | `{ success, count, data: [...] }`              |
| GET    | `/v1/schedules/:id`         | Satu jadwal                     | header `Authorization`; param `id`                             | `{ success, data }` / 404                      |
| POST   | `/v1/schedules`             | Tambah jadwal (admin)           | header `Authorization`, opsional `Idempotency-Key`; body jadwal | `201 { success, data }` / 400 / 403 / 409     |
| PUT    | `/v1/schedules/:id`         | Ubah jadwal (admin)             | header `Authorization`; param `id`; body jadwal                | `{ success, message, data }` / 400 / 404 / 409 |
| DELETE | `/v1/schedules/:id`         | Hapus jadwal (admin)            | header `Authorization`; param `id`                             | `{ success, message }` / 404                   |
| PUT    | `/v1/schedules/:id/publish` | Publikasikan jadwal (admin)     | header `Authorization`; param `id`                             | `{ success, message }` / 404                   |

Field body jadwal: `subject` (maks. 100 karakter), `teacher` (maks. 100),
`meeting_link` (URL http/https, maks. 255), `day` (Senin sampai Sabtu),
`start_time` dan `end_time` (format `HH:MM` atau `HH:MM:SS`).

Viewer hanya menerima jadwal yang sudah dipublikasikan. Jadwal draft tidak muncul di
daftar dan `GET /v1/schedules/:id` untuk draft mengembalikan 404.

Catatan: Jaberkel adalah bimbel online, jadi tidak ada ruangan fisik. Kolom
`meeting_link` (tautan Zoom/Google Meet) menggantikan ruangan. Dua sesi dianggap
bentrok bila berada di hari yang sama, memakai guru yang sama atau link kelas yang
sama, dan waktunya tumpang tindih. Seorang guru tidak bisa mengajar dua kelas daring
sekaligus, dan satu link tidak bisa dipakai dua sesi bersamaan.

### Cara parameter diperoleh (Soal 2d / 3b)

- Path param (`:id`) dari `req.params.id`, divalidasi sebagai bilangan bulat positif.
- Query param (`?q=`) dari `req.query.q`.
- Body JSON dibaca middleware `express.json()` (batas 10 KB), lalu `req.body`.
- Header dari `req.get('Idempotency-Key')` dan `req.get('Authorization')`.

### Komunikasi sukses dan gagal ke client (Soal 2d)

Semua balasan berbentuk `{ success, message, data | errors }` dengan HTTP status yang
sesuai:

| Skenario                    | Status | Isi                                          |
|-----------------------------|--------|----------------------------------------------|
| Berhasil tambah             | 201    | `success: true, data`                        |
| Berhasil ubah / hapus       | 200    | `success: true, message`                     |
| Validasi gagal              | 400    | `success: false, errors: [...]`              |
| Belum login / token invalid | 401    | `success: false, message`                    |
| Bukan admin                 | 403    | `success: false, message`                    |
| Tidak ditemukan             | 404    | `success: false, message`                    |
| Bentrok jadwal              | 409    | `success: false, conflicting_schedules: [...]` |
| Terlalu banyak login gagal  | 429    | `success: false, message`                    |
| Kesalahan server            | 500    | `success: false, message` (tanpa detail teknis) |

Detail error 500 hanya dicatat di log server dan tidak pernah dikirim ke client.

## 4. Skenario uji (Soal 3c)

| Test case          | Input                                                                                   | Expected result                              |
|--------------------|-----------------------------------------------------------------------------------------|----------------------------------------------|
| Sukses tambah      | Jadwal valid di slot kosong, mis. Jumat 13:00–15:00, link `https://meet.google.com/pemweb-01` | `201 Created`, data dengan ID baru     |
| Gagal validasi     | `subject` kosong dan `start_time` lebih besar dari `end_time`                           | `400 Bad Request`, daftar `errors`           |
| Gagal bentrok      | Senin 08:00–09:00 dengan guru Drs. Bambang Wijaya (menabrak Matematika Wajib)           | `409 Conflict`, `conflicting_schedules`      |
| Gagal akses        | Viewer (siswa) menambah jadwal                                                          | `403 Forbidden`                              |
| Anti-duplikat      | Dua POST dengan `Idempotency-Key` yang sama                                             | Data dibuat sekali, balasan kedua `replayed: true` |

Uji lewat Postman: impor `postman_collection.json`, jalankan request login lebih dulu
(token tersimpan otomatis), lalu request lainnya. Setiap request punya assertion status
code. Impor ulang `schema.sql` untuk mengembalikan data ke kondisi awal.

## 5. Keamanan

- `JWT_SECRET` wajib dari environment dan minimal 32 karakter, tanpa nilai default.
  Algoritma JWT dikunci ke HS256.
- `.env` tidak ikut di-commit; `.env.example` hanya berisi placeholder.
- Password disimpan sebagai hash bcrypt. Login dengan username yang tidak ada tetap
  menjalankan bcrypt, sehingga waktu respons tidak membocorkan username mana yang ada.
- Login dibatasi 10 percobaan gagal per 15 menit per IP.
- Semua query yang menerima input memakai prepared statement (`execute`). Input
  divalidasi tipe, format dan panjangnya sebelum menyentuh database.
- Frontend meng-escape semua data sebelum dirender dan hanya membuat link untuk URL
  `http`/`https`. Header keamanan (CSP, `X-Content-Type-Options`, dsb.) dipasang
  lewat `helmet`.
- CORS nonaktif secara default karena frontend dan API berada di origin yang sama.
  Isi `CORS_ORIGIN` bila ada client dari domain lain.
- Cek bentrok dan insert berjalan dalam satu transaksi dengan `SELECT ... FOR UPDATE`,
  sehingga dua request bersamaan untuk slot yang sama tidak bisa sama-sama lolos.

Di luar lingkungan lokal, jangan memakai akun `root`. Buat user khusus dengan hak
minimum:

```sql
CREATE USER 'jaberkel_app'@'localhost' IDENTIFIED BY 'ganti-dengan-password-kuat';
GRANT SELECT, INSERT, UPDATE, DELETE ON db_jaberkel.* TO 'jaberkel_app'@'localhost';
```

Port MySQL (3306) juga sebaiknya tidak dibuka ke jaringan publik.

## 6. Pengujian otomatis

```bash
npm test        # unit test, test HTTP, dan test startup (tanpa database)
npm run lint
```

Integration test berjalan terhadap MySQL/MariaDB sungguhan, termasuk uji 20 request
bersamaan untuk slot yang sama. Test ini membuat lalu menghapus database yang
namanya diberikan lewat `TEST_DB_NAME`, jadi jangan pakai `db_jaberkel`:

```bash
TEST_DB_NAME=db_jaberkel_test npm test            # bash
$env:TEST_DB_NAME="db_jaberkel_test"; npm test    # PowerShell
```

## 7. Struktur proyek

```
jaberkel-penjadwalan/
├── server.js                  # startup: cek config dan DB, listen, graceful shutdown
├── app.js                     # konfigurasi Express (middleware dan routing)
├── config.js                  # membaca dan memvalidasi environment variable
├── db.js                      # connection pool MySQL dan helper transaksi
├── schema.sql                 # skema database dan data contoh
├── .env.example               # contoh konfigurasi
├── postman_collection.json    # koleksi uji API
├── lib/
│   ├── http.js                # HttpError dan asyncHandler
│   └── token.js               # sign dan verify JWT
├── middleware/
│   ├── auth.js                # Auth Service: verifikasi token dan cek role
│   └── errors.js              # 404 dan error handler terpusat
├── routes/
│   ├── auth.js                # POST /v1/auth/login
│   └── schedules.js           # CRUD dan publish (orchestration)
├── services/
│   └── checkConflict.js       # CheckConflict: deteksi bentrok
├── validators/
│   └── schedule.js            # validasi dan normalisasi input
├── test/                      # node:test
└── public/                    # frontend
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 8. Ketahanan antar-service (lanjutan Tugas 13)

Handler POST sudah memuat idempotency key (anti data ganda, aman untuk request yang
dikirim bersamaan), validasi, pemanggilan CheckConflict, dan transaksi
commit/rollback (anti data setengah jadi). Deadlock InnoDB yang muncul saat dua
request berebut slot yang sama di-retry otomatis. Timeout dan circuit breaker perlu
ditambahkan bila CheckConflict dipisah ke proses atau port sendiri seperti pada
Tugas 13.
