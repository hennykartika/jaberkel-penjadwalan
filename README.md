# Jaberkel — Modul Penjadwalan (Schedule Service)

Final Project · System Development and Implementation
**Henny Kartika · 6026252017**

Aplikasi penjadwalan pelajaran berbasis arsitektur SOA: REST API dengan
**Node.js + Express + MySQL** dan antarmuka web interaktif. Modul yang dikerjakan
hanya **Penjadwalan** (satu modul satu orang). Manajemen Pengguna hanya muncul
sebatas login untuk kontrol akses.

---

## 1. Cara menjalankan (XAMPP / Laragon)

**Prasyarat:** Node.js v18+ dan MySQL (lewat XAMPP atau Laragon).

1. **Impor database.** Buka phpMyAdmin → tab **Import** → pilih `schema.sql` → Go.
   Database `jaberkel` beserta tabel `users`, `schedules`, `idempotency_keys`
   dan data contoh akan terbentuk otomatis.
2. **Siapkan konfigurasi.** Salin `.env.example` menjadi `.env` dan sesuaikan
   (default XAMPP: user `root`, password kosong).
   ```bash
   cp .env.example .env
   ```
3. **Pasang dependency lalu jalankan.**
   ```bash
   npm install
   npm start
   ```
4. Buka **http://localhost:3000** di browser.

### Akun demo

| Username | Password   | Peran   | Hak akses                                   |
|----------|------------|---------|---------------------------------------------|
| `admin`  | `admin123` | admin   | Lihat + tambah/ubah/hapus/publikasi jadwal  |
| `siswa`  | `siswa123` | viewer  | Hanya melihat jadwal                        |

---

## 2. Soal kenapa pakai login

Login **dipakai, tapi ringan**, karena memang menjawab kebutuhan use case:

- Use case description Tugas 12/13 menyebut **FR-SCH-01**: hanya admin yang boleh
  menambah/mengubah jadwal, sedangkan siswa & guru hanya melihat. Tanpa login,
  aturan ini tidak bisa ditegakkan.
- Login mengisi peran **Auth Service (Utility)** pada arsitektur SOA — jadi
  arsitektur di laporan benar-benar terimplementasi, bukan hanya digambar.
- Memberi skenario **GAGAL** yang bagus untuk pengujian: viewer mencoba menambah
  jadwal → ditolak `403 Forbidden`.

Login dibuat sederhana (satu endpoint `POST /v1/auth/login`, token JWT) supaya
tidak membebani demo. Bila dosen ingin tanpa login, cukup lepas middleware
`authenticate`/`requireAdmin` pada `routes/schedules.js` — strukturnya sudah dipisah.

---

## 3. Arsitektur SOA (untuk laporan Soal 2)

```
                        ┌───────────────────────────┐
   Browser (Frontend) ──►   Process / Orchestration  │  POST/PUT handler
   public/ index.html      │   pada routes/schedules │  mengatur urutan langkah
        │  fetch + JWT      └──────────┬────────────-─┘
        │                              │ memanggil
        ▼                   ┌──────────▼──────────┐
   ┌─────────────┐          │  CheckConflict       │  (underlying service)
   │ Auth Service│◄─────────┤  services/           │  cek bentrok guru/link/waktu  
   │ middleware  │  verifi-  │  checkConflict.js   │
   │ /auth, JWT  │  kasi     └──────────┬──────────┘
   └─────────────┘                      │
                             ┌──────────▼──────────┐
                             │  Schedule Entity     │  CRUD murni ke tabel
                             │  Service (MySQL)     │  schedules
                             └─────────────────────-┘
```

- **Presentation layer** — frontend `public/` (HTML/CSS/JS), memanggil REST API.
- **Business/Process layer** — handler `POST /v1/schedules` & `PUT` berperan sebagai
  *orchestrator*: validasi → cek idempotency → panggil CheckConflict → simpan dalam
  transaction.
- **Service/Utility layer** — Auth Service (middleware JWT) dan CheckConflict
  (modul terpisah, memetakan ke microservice pada desain).
- **Data layer** — MySQL melalui connection pool (`db.js`).

### Tabel service / routing (Soal 2b)

| Method | Path                          | Deskripsi                       | Input Parameters                                                  | Return Values                                  |
|--------|-------------------------------|----------------------------------|-------------------------------------------------------------------|------------------------------------------------|
| POST   | `/v1/auth/login`              | Login, hasilkan token            | body: `username`, `password`                                      | `{ success, data:{ token, user } }`            |
| GET    | `/v1/schedules`               | Semua jadwal (+ cari `?q=`)      | header `Authorization`; query `q`                                 | `{ success, count, data:[...] }`               |
| GET    | `/v1/schedules/:id`           | Satu jadwal                      | header `Authorization`; param `id`                                | `{ success, data:{...} }` / 404                |
| POST   | `/v1/schedules`               | Tambah jadwal (admin)            | header `Authorization`, opsional `Idempotency-Key`; body jadwal   | `201 { success, data }` / 400 / 409 / 403      |
| PUT    | `/v1/schedules/:id`           | Ubah jadwal (admin)              | header `Authorization`; param `id`; body jadwal                   | `{ success, message }` / 400 / 404 / 409       |
| DELETE | `/v1/schedules/:id`           | Hapus jadwal (admin)             | header `Authorization`; param `id`                                | `{ success, message }` / 404                   |
| PUT    | `/v1/schedules/:id/publish`   | Publikasikan jadwal (admin)      | header `Authorization`; param `id`                                | `{ success, message }` / 404                   |

**Field body jadwal:** `subject`, `teacher`, `meeting_link` (URL kelas online), `day` (Senin–Sabtu),
`start_time`, `end_time` (format `HH:MM:SS`).

> **Catatan: Jaberkel adalah bimbel _online_.** Karena tidak ada ruangan fisik, kolom
> `meeting_link` (tautan Zoom/Google Meet) menggantikan "ruangan". Aturan bentrok pun
> menyesuaikan: dua sesi dianggap bentrok bila pada hari yang sama memakai **guru yang sama
> ATAU link kelas yang sama** dengan waktu yang tumpang tindih — sebab seorang guru tidak bisa
> mengajar dua kelas daring sekaligus, dan satu link tidak bisa dipakai dua sesi bersamaan.

### Cara parameter diperoleh (Soal 2d / 3b)

- **Path param** (`:id`) → `req.params.id` (untuk GET/PUT/DELETE per ID).
- **Query param** (`?q=`) → `req.query.q` (pencarian).
- **Body JSON** → dibaca middleware `express.json()` lalu `req.body` (POST/PUT).
- **Header** → `req.header('Idempotency-Key')` dan `Authorization` (token).

### Komunikasi sukses / gagal ke client (Soal 2d)

Semua balasan seragam: `{ success: true/false, message, data/errors }`
dengan **HTTP status** yang sesuai:

| Skenario              | Status | Isi                                              |
|-----------------------|--------|--------------------------------------------------|
| Berhasil tambah       | 201    | `success:true, data`                             |
| Berhasil ubah/hapus   | 200    | `success:true, message`                          |
| Validasi gagal        | 400    | `success:false, errors:[...]`                    |
| Bentrok jadwal        | 409    | `success:false, conflicting_schedules:[...]`     |
| Bukan admin           | 403    | `success:false, message`                         |
| Belum/ token invalid  | 401    | `success:false, message`                         |
| Tidak ditemukan       | 404    | `success:false, message`                         |

---

## 4. Skenario uji (Soal 3c, untuk video & laporan)

| Test Case               | Input                                                                 | Expected Result                              |
|-------------------------|-----------------------------------------------------------------------|----------------------------------------------|
| **SUKSES** tambah       | jadwal valid, slot kosong (mis. Jumat 13:00–15:00, Lab Komputer 1)    | `201 Created`, data ber-ID baru              |
| **GAGAL** validasi      | `subject` kosong & `start_time` > `end_time`                          | `400 Bad Request`, daftar `errors`           |
| **GAGAL** bentrok       | Senin 08:00–09:00 dengan guru Drs. Bambang (menabrak Matematika)           | `409 Conflict`, `conflicting_schedules`      |
| **GAGAL** akses         | viewer (siswa) menambah jadwal                                        | `403 Forbidden`                              |
| Anti-duplikat           | dua POST dengan `Idempotency-Key` sama                                | dibuat sekali, balasan kedua `replayed:true` |

Uji cepat lewat Postman: impor `postman_collection.json`, jalankan
**Login (admin)** dulu (token tersimpan otomatis), lalu request lainnya.

---

## 5. Struktur proyek

```
jaberkel-penjadwalan/
├── server.js                 # entry point Express + penyaji frontend
├── db.js                     # connection pool MySQL
├── schema.sql                # database + data contoh + akun (impor ke phpMyAdmin)
├── .env.example              # contoh konfigurasi
├── postman_collection.json   # koleksi uji API
├── middleware/auth.js        # Auth Service: verifikasi JWT + cek role
├── services/checkConflict.js # CheckConflict: deteksi bentrok
├── routes/
│   ├── auth.js               # POST /v1/auth/login
│   └── schedules.js          # CRUD + publish (entity + orchestration)
└── public/                   # FRONTEND
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 6. Ketahanan antar-service (lanjutan Tugas 13)

Handler POST sudah memuat: **idempotency key** (anti data ganda), **validasi**,
panggilan **CheckConflict** sebelum simpan, dan **transaction commit/rollback**
(anti data setengah jadi). Tinggal menambah timeout/circuit-breaker bila
CheckConflict dipisah ke proses/port sendiri seperti pada Tugas 13.

---
*Dibuat untuk Final Project — modul Penjadwalan. Henny Kartika, 6026252017.*
