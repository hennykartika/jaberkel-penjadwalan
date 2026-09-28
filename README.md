# Jaberkel: Scheduling Module (Schedule Service)

Final Project · System Development and Implementation

Henny Kartika · 6026252017

A class scheduling service for Jaberkel, an online tutoring center. The backend is a
REST API (Node.js, Express, MySQL), and a static web frontend is served by the same
server. Only the Scheduling module is in scope; user management exists only as far as
signing in for access control.

## 1. Running locally

Requirements: Node.js 20 or newer (the latest LTS is recommended) and MySQL or MariaDB
(XAMPP or Laragon work fine).

1. Import the database. In phpMyAdmin open the Import tab, choose `schema.sql` and
   click Go. From a terminal: `mysql -u root -p < schema.sql`.
   The script creates the `db_jaberkel` database with the `users`, `schedules` and
   `idempotency_keys` tables plus demo data. It drops and recreates every table, so
   any existing data in `db_jaberkel` is lost.
2. Create your configuration.
   ```bash
   cp .env.example .env
   ```
   Set `JWT_SECRET` (required, at least 32 characters). The server refuses to start
   if it is empty or too short. Generate a random one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   For a default XAMPP install use `DB_USER=root` and leave `DB_PASSWORD` empty.
3. Install dependencies and start the server.
   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:3000.

The server also refuses to start when it cannot reach the database, so configuration
mistakes show up at startup instead of on the first request.

### Demo accounts

| Username  | Password     | Role   | Permissions                                   |
|-----------|--------------|--------|-----------------------------------------------|
| `admin`   | `admin123`   | admin  | View all schedules; create, edit, delete, publish |
| `student` | `student123` | viewer | View published schedules only                 |

These accounts are for local demos only. Change or remove them before deploying
anywhere other people can reach.

## 2. Why there is a login

- Use case FR-SCH-01 (Assignments 12 and 13): only admins may create and change
  schedules, while students and teachers can only view them. That rule cannot be
  enforced without knowing who the user is.
- Signing in fills the role of the Auth Service (a utility service) in the SOA
  design, so the architecture in the report is actually implemented.
- It provides a failure case for testing: a viewer who tries to create a schedule
  gets `403 Forbidden`.

Authentication is kept small: a single `POST /v1/auth/login` endpoint that returns a
JWT, valid for 8 hours by default (configurable with `JWT_EXPIRES_IN`, e.g. `30m`,
`8h`, `7d`).

## 3. SOA architecture

```
Browser (public/)
   │  fetch + Bearer token
   ▼
Process / orchestration      routes/schedules.js
(POST and PUT handlers)      validate → idempotency → CheckConflict → save
   │                                     │
   │ verify token                        │ inside one transaction
   ▼                                     ▼
Auth Service                 CheckConflict                 Schedule entity
middleware/auth.js           services/checkConflict.js     schedules table (MySQL)
lib/token.js                 teacher / link / time clashes
```

- Presentation layer: the `public/` frontend (HTML, CSS, JS) calling the REST API.
- Process layer: `POST /v1/schedules` and `PUT /v1/schedules/:id` act as
  orchestrators. Input is validated first; the idempotency check, CheckConflict and
  the write then run inside a single database transaction.
- Service / utility layer: the Auth Service (JWT verification and role checks) and
  CheckConflict (a separate module that maps to the microservice in the design).
- Data layer: MySQL through a connection pool (`db.js`).

### Service routing table (Question 2b)

| Method | Path                        | Description                     | Input                                                             | Returns                                         |
|--------|-----------------------------|---------------------------------|-------------------------------------------------------------------|-------------------------------------------------|
| POST   | `/v1/auth/login`            | Sign in and get a token         | body: `username`, `password`                                      | `{ success, data: { token, user } }`            |
| GET    | `/v1/schedules`             | List schedules, search with `?q=` | header `Authorization`; query `q`                               | `{ success, count, data: [...] }`               |
| GET    | `/v1/schedules/:id`         | Get one schedule                | header `Authorization`; param `id`                                | `{ success, data }` / 404                       |
| POST   | `/v1/schedules`             | Create a schedule (admin)       | header `Authorization`, optional `Idempotency-Key`; schedule body | `201 { success, data }` / 400 / 403 / 409       |
| PUT    | `/v1/schedules/:id`         | Update a schedule (admin)       | header `Authorization`; param `id`; schedule body                 | `{ success, message, data }` / 400 / 404 / 409  |
| DELETE | `/v1/schedules/:id`         | Delete a schedule (admin)       | header `Authorization`; param `id`                                | `{ success, message }` / 404                    |
| PUT    | `/v1/schedules/:id/publish` | Publish a schedule (admin)      | header `Authorization`; param `id`                                | `{ success, message }` / 404                    |

Schedule body fields: `subject` (max. 100 characters), `teacher` (max. 100),
`meeting_link` (http/https URL, max. 255), `day` (`Monday` to `Saturday`), and
`start_time` / `end_time` (`HH:MM` or `HH:MM:SS`).

Viewers only receive published schedules. Drafts are left out of the list, and
`GET /v1/schedules/:id` returns 404 for a draft.

Note: Jaberkel teaches online, so there are no physical rooms. The `meeting_link`
column (a Zoom or Google Meet URL) takes the place of a room. Two sessions conflict
when they are on the same day, share the same teacher or the same meeting link, and
their times overlap. A teacher cannot run two online classes at once, and one link
cannot host two sessions at the same time.

### How parameters are read (Questions 2d and 3b)

- Path parameter (`:id`) from `req.params.id`, validated as a positive integer.
- Query parameter (`?q=`) from `req.query.q`.
- JSON body parsed by `express.json()` (10 KB limit) into `req.body`.
- Headers from `req.get('Idempotency-Key')` and `req.get('Authorization')`.

### Reporting success and failure to the client (Question 2d)

Every response has the shape `{ success, message, data | errors }` with a matching
HTTP status:

| Scenario                      | Status | Body                                            |
|-------------------------------|--------|-------------------------------------------------|
| Created                       | 201    | `success: true, data`                           |
| Updated / deleted             | 200    | `success: true, message`                        |
| Validation failed             | 400    | `success: false, errors: [...]`                 |
| Not signed in / invalid token | 401    | `success: false, message`                       |
| Not an admin                  | 403    | `success: false, message`                       |
| Not found                     | 404    | `success: false, message`                       |
| Schedule conflict             | 409    | `success: false, conflicting_schedules: [...]`  |
| Too many failed sign-ins      | 429    | `success: false, message`                       |
| Server error                  | 500    | `success: false, message` (no technical details) |

Details of a 500 error are written to the server log only and never sent to the
client.

## 4. Test scenarios (Question 3c)

| Test case          | Input                                                                                          | Expected result                                  |
|--------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------|
| Create succeeds    | A valid schedule in a free slot, e.g. Friday 13:00–15:00, link `https://meet.google.com/webdev-01` | `201 Created`, data with a new ID            |
| Validation fails   | Empty `subject` and `start_time` later than `end_time`                                         | `400 Bad Request`, list of `errors`              |
| Conflict           | Monday 08:00–09:00 with teacher Drs. Bambang Wijaya (overlaps Mathematics)                     | `409 Conflict`, `conflicting_schedules`          |
| Access denied      | A viewer (student) creates a schedule                                                          | `403 Forbidden`                                  |
| No duplicates      | Two POSTs with the same `Idempotency-Key`                                                      | Created once; the second response has `replayed: true` |

To test with Postman, import `postman_collection.json`, run the two login requests
first (they store the tokens), then the rest. Every request asserts its expected
status code. Re-import `schema.sql` to reset the data.

## 5. Security

- `JWT_SECRET` must come from the environment and be at least 32 characters; there is
  no default value. The JWT algorithm is pinned to HS256.
- `.env` is never committed; `.env.example` only contains placeholders.
- Passwords are stored as bcrypt hashes. A sign-in with an unknown username still
  runs bcrypt, so response times do not reveal which usernames exist.
- Sign-in is limited to 10 failed attempts per 15 minutes per IP.
- Every query that takes input uses a prepared statement (`execute`). Input type,
  format and length are validated before anything reaches the database.
- The frontend escapes all data before rendering it and only creates links for
  `http`/`https` URLs. Security headers (CSP, `X-Content-Type-Options`, etc.) are set
  with `helmet`.
- CORS is off by default because the frontend and the API share one origin. Set
  `CORS_ORIGIN` if a client on another domain needs access.
- The conflict check and the insert run in one transaction with
  `SELECT ... FOR UPDATE`, so two simultaneous requests for the same slot cannot both
  succeed.

Outside local development, do not use the `root` account. Create a dedicated user
with minimal privileges:

```sql
CREATE USER 'jaberkel_app'@'localhost' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON db_jaberkel.* TO 'jaberkel_app'@'localhost';
```

Do not expose the MySQL port (3306) to a public network either.

## 6. Automated tests

```bash
npm test        # unit, HTTP and startup tests (no database needed)
npm run lint
```

The integration tests run against a real MySQL or MariaDB server, including 20
simultaneous requests for the same slot. They create and then drop the database named
in `TEST_DB_NAME`, so never point it at `db_jaberkel`:

```bash
TEST_DB_NAME=db_jaberkel_test npm test            # bash
$env:TEST_DB_NAME="db_jaberkel_test"; npm test    # PowerShell
```

## 7. Project structure

```
jaberkel-penjadwalan/
├── server.js                  # startup: check config and DB, listen, graceful shutdown
├── app.js                     # Express setup (middleware and routing)
├── config.js                  # reads and validates environment variables
├── db.js                      # MySQL connection pool and transaction helper
├── schema.sql                 # database schema and demo data
├── .env.example               # sample configuration
├── postman_collection.json    # API test collection
├── lib/
│   ├── http.js                # HttpError and asyncHandler
│   └── token.js               # JWT sign and verify
├── middleware/
│   ├── auth.js                # Auth Service: token verification and role checks
│   └── errors.js              # 404 and central error handler
├── routes/
│   ├── auth.js                # POST /v1/auth/login
│   └── schedules.js           # CRUD and publish (orchestration)
├── services/
│   └── checkConflict.js       # CheckConflict: conflict detection
├── validators/
│   └── schedule.js            # input validation and normalization
├── test/                      # node:test
└── public/                    # frontend
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 8. Service resilience (follow-up to Assignment 13)

The POST handler already covers idempotency keys (no duplicate records, safe for
concurrent retries), validation, the CheckConflict call, and commit/rollback
transactions (no half-written data). InnoDB deadlocks that occur when two requests
compete for the same slot are retried automatically. Timeouts and a circuit breaker
would be the next step if CheckConflict were moved to its own process or port, as
described in Assignment 13.
