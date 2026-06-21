/* =====================================================================
   Jaberkel · Penjadwalan — Logika Frontend
   Berkomunikasi dengan Schedule Service melalui REST API (fetch + Bearer token).
   ===================================================================== */

const API = '/v1';
const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Jendela waktu yang ditampilkan pada grid mingguan.
const DAY_START = 7 * 60;   // 07:00
const DAY_END   = 18 * 60;  // 18:00
const PX_PER_MIN = 1.0;     // 1 menit = 1 px  -> total 660 px

// Palet warna per mata pelajaran (di-cycle berdasarkan hash nama).
const SUBJECT_COLORS = [
  '#6366f1', '#14b8a6', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#22c55e',
];

const state = {
  token: localStorage.getItem('jbk_token') || null,
  user: JSON.parse(localStorage.getItem('jbk_user') || 'null'),
  schedules: [],
  view: 'grid',
  query: '',
  editingId: null,
  deleteId: null,
};

/* ---------- Helper ---------- */
const $ = (sel) => document.querySelector(sel);
const el = (sel) => document.querySelector(sel);

function colorFor(subject) {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}
function toMin(t) { // "HH:MM:SS" / "HH:MM" -> menit
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m);
}
function hhmm(t) { return String(t).slice(0, 5); }
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (state.token) opts.headers.Authorization = 'Bearer ' + state.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

/* ---------- Toast ---------- */
function toast(title, msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast toast--' + type;
  t.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; }, 3000);
  setTimeout(() => t.remove(), 3400);
}

/* =====================================================================
   LOGIN
   ===================================================================== */
async function doLogin(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  if (!r.ok) {
    const e = $('#loginError'); e.hidden = false;
    e.textContent = r.data.message || 'Login gagal.';
    return;
  }
  state.token = r.data.data.token;
  state.user = r.data.data.user;
  localStorage.setItem('jbk_token', state.token);
  localStorage.setItem('jbk_user', JSON.stringify(state.user));
  enterApp();
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('jbk_token');
  localStorage.removeItem('jbk_user');
  $('#app').hidden = true;
  $('#loginScreen').hidden = false;
  $('#loginUser').value = ''; $('#loginPass').value = '';
}

function enterApp() {
  $('#loginScreen').hidden = true;
  $('#app').hidden = false;
  const u = state.user;
  $('#userName').textContent = u.name;
  $('#userRole').textContent = u.role === 'admin' ? 'Administrator' : 'Hanya lihat';
  $('#userAvatar').textContent = initials(u.name);
  const isAdmin = u.role === 'admin';
  $('#addBtn').hidden = !isAdmin;
  loadSchedules();
}

/* =====================================================================
   DATA
   ===================================================================== */
async function loadSchedules() {
  const q = state.query ? '?q=' + encodeURIComponent(state.query) : '';
  const r = await api('/schedules' + q);
  if (r.status === 401) { logout(); return; }
  if (!r.ok) { toast('Gagal memuat', r.data.message || 'Terjadi kesalahan.', 'err'); return; }
  state.schedules = r.data.data || [];
  renderStats();
  render();
}

/* ---------- Statistik ---------- */
function renderStats() {
  const all = state.schedules;
  const pub = all.filter((s) => s.published).length;
  const draft = all.length - pub;
  const teachers = new Set(all.map((s) => s.teacher)).size;
  const cards = [
    { num: all.length, lbl: 'Total Jadwal', c: 'var(--primary)' },
    { num: pub, lbl: 'Terpublikasi', c: 'var(--ok)' },
    { num: draft, lbl: 'Masih Draft', c: 'var(--warn)' },
    { num: teachers, lbl: 'Guru Terlibat', c: 'var(--accent)' },
  ];
  $('#stats').innerHTML = cards.map((c) => `
    <div class="stat">
      <span class="stat__bar" style="background:${c.c}"></span>
      <div class="stat__num">${c.num}</div>
      <div class="stat__lbl">${c.lbl}</div>
    </div>`).join('');
}

/* ---------- Render utama ---------- */
function render() {
  if (state.view === 'grid') { $('#gridView').hidden = false; $('#listView').hidden = true; renderGrid(); }
  else { $('#gridView').hidden = true; $('#listView').hidden = false; renderList(); }
}

/* ---------- Grid mingguan (signature) ---------- */
function renderGrid() {
  const board = $('#gridView');
  if (state.schedules.length === 0) {
    board.innerHTML = `<div class="board__empty"><strong>Belum ada jadwal</strong>
      ${state.user.role === 'admin' ? 'Klik “Tambah Jadwal” untuk mulai menyusun.' : 'Jadwal belum tersedia.'}</div>`;
    return;
  }

  // Tentukan kolom hari yang tampil (minimal Senin–Jumat, tambah bila ada data Sabtu).
  const used = new Set(state.schedules.map((s) => s.day));
  const cols = DAYS.filter((d, i) => i < 5 || used.has(d));
  const totalMin = DAY_END - DAY_START;
  const bodyH = totalMin * PX_PER_MIN;
  const isAdmin = state.user.role === 'admin';

  // Header
  let head = `<div class="timetable__corner"></div>`;
  cols.forEach((d) => {
    const n = state.schedules.filter((s) => s.day === d).length;
    head += `<div class="timetable__day">${d}<small>${n} sesi</small></div>`;
  });

  // Garis jam + label
  let rail = '';
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const top = (m - DAY_START) * PX_PER_MIN;
    rail += `<div class="timerail__mark" style="top:${top}px">${String(m / 60).padStart(2, '0')}:00</div>`;
  }

  // Kolom hari + event
  let cells = `<div class="timerail" style="height:${bodyH}px">${rail}</div>`;
  cols.forEach((d) => {
    const events = state.schedules
      .filter((s) => s.day === d)
      .map((s) => ({ ...s, startMin: toMin(s.start_time), endMin: toMin(s.end_time) }));
    layoutLanes(events); // hitung lajur untuk event yang tumpang tindih

    let hours = '';
    for (let m = DAY_START + 60; m < DAY_END; m += 60) {
      hours += `<div class="daycol__hour" style="top:${(m - DAY_START) * PX_PER_MIN}px"></div>`;
    }

    let evHtml = '';
    events.forEach((ev) => {
      const top = Math.max(0, (ev.startMin - DAY_START) * PX_PER_MIN);
      const h = Math.max(34, (ev.endMin - ev.startMin) * PX_PER_MIN - 4);
      const w = 100 / ev.laneCount;
      const color = colorFor(ev.subject);
      evHtml += `
        <div class="event ${isAdmin ? 'is-admin' : ''}"
             style="top:${top}px;height:${h}px;left:calc(${ev.lane * w}% + 4px);width:calc(${w}% - 8px);right:auto;background:${color}"
             data-id="${ev.id}">
          ${ev.published ? '' : '<span class="event__draft">DRAFT</span>'}
          <div class="event__subj">${escapeHtml(ev.subject)}</div>
          <div class="event__meta">🌐 Daring · ${escapeHtml(ev.teacher)}</div>
          <div class="event__time">${hhmm(ev.start_time)}–${hhmm(ev.end_time)}</div>
        </div>`;
    });

    cells += `<div class="daycol" style="height:${bodyH}px">${hours}${evHtml}</div>`;
  });

  board.innerHTML = `
    <div class="timetable" style="--cols:${cols.length}">
      <div class="timetable__head">${head}</div>
      <div class="timetable__body">${cells}</div>
    </div>`;

  if (isAdmin) {
    board.querySelectorAll('.event.is-admin').forEach((node) =>
      node.addEventListener('click', () => openEdit(Number(node.dataset.id))));
  }
}

// Tata letak lajur: event yang tumpang tindih waktunya diletakkan berdampingan.
function layoutLanes(events) {
  events.sort((a, b) => a.startMin - b.startMin);
  const lanes = [];
  events.forEach((ev) => {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (ev.startMin >= lanes[i]) { lanes[i] = ev.endMin; ev.lane = i; placed = true; break; }
    }
    if (!placed) { ev.lane = lanes.length; lanes.push(ev.endMin); }
  });
  const count = Math.max(1, lanes.length);
  events.forEach((ev) => { ev.laneCount = count; });
}

/* ---------- Daftar (tabel) ---------- */
function renderList() {
  const wrap = $('#listView');
  if (state.schedules.length === 0) {
    wrap.innerHTML = `<div class="listwrap__empty"><strong>Belum ada jadwal</strong>Data tidak ditemukan.</div>`;
    return;
  }
  const isAdmin = state.user.role === 'admin';
  const rows = state.schedules.map((s) => {
    const color = colorFor(s.subject);
    const badge = s.published
      ? '<span class="badge badge--ok">Terpublikasi</span>'
      : '<span class="badge badge--draft">Draft</span>';
    const actions = isAdmin ? `
      <div class="rowactions">
        ${s.published ? '' : `<button class="iconbtn iconbtn--pub" data-pub="${s.id}">Publikasikan</button>`}
        <button class="iconbtn" data-edit="${s.id}">Edit</button>
        <button class="iconbtn iconbtn--del" data-del="${s.id}">Hapus</button>
      </div>` : '';
    return `
      <tr>
        <td><div class="subjcell"><span class="subjdot" style="background:${color}"></span>
          <span><strong>${escapeHtml(s.subject)}</strong><small>${escapeHtml(s.teacher)}</small></span></div></td>
        <td><a class="linkcell" href="${escapeHtml(s.meeting_link)}" target="_blank" rel="noopener">Buka kelas ↗</a></td>
        <td><span class="daypill">${s.day}</span></td>
        <td class="timecell">${hhmm(s.start_time)} – ${hhmm(s.end_time)}</td>
        <td>${badge}</td>
        ${isAdmin ? `<td>${actions}</td>` : ''}
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>Mata Pelajaran</th><th>Link Kelas</th><th>Hari</th><th>Waktu</th><th>Status</th>
        ${isAdmin ? '<th style="text-align:right">Aksi</th>' : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  if (isAdmin) {
    wrap.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEdit(Number(b.dataset.edit)));
    wrap.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => openConfirm(Number(b.dataset.del)));
    wrap.querySelectorAll('[data-pub]').forEach((b) => b.onclick = () => publish(Number(b.dataset.pub)));
  }
}

/* =====================================================================
   MODAL TAMBAH / EDIT
   ===================================================================== */
function openAdd() {
  state.editingId = null;
  $('#modalTitle').textContent = 'Tambah Jadwal';
  $('#fId').value = '';
  $('#fSubject').value = ''; $('#fTeacher').value = ''; $('#fLink').value = '';
  $('#fDay').value = 'Senin'; $('#fStart').value = '08:00'; $('#fEnd').value = '09:30';
  $('#conflictHint').hidden = true; $('#formError').hidden = true;
  $('#modal').hidden = false;
  checkLiveConflict();
}
function openEdit(id) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  state.editingId = id;
  $('#modalTitle').textContent = 'Edit Jadwal';
  $('#fId').value = id;
  $('#fSubject').value = s.subject; $('#fTeacher').value = s.teacher; $('#fLink').value = s.meeting_link;
  $('#fDay').value = s.day; $('#fStart').value = hhmm(s.start_time); $('#fEnd').value = hhmm(s.end_time);
  $('#conflictHint').hidden = true; $('#formError').hidden = true;
  $('#modal').hidden = false;
  checkLiveConflict();
}
function closeModal() { $('#modal').hidden = true; }

// Deteksi bentrok cepat di sisi klien (server tetap pemutus akhir).
function checkLiveConflict() {
  const teacher = $('#fTeacher').value.trim();
  const link = $('#fLink').value.trim();
  const day = $('#fDay').value;
  const st = $('#fStart').value, en = $('#fEnd').value;
  const hint = $('#conflictHint');
  if (!teacher || !link || !st || !en || st >= en) { hint.hidden = true; return; }

  const sMin = toMin(st), eMin = toMin(en);
  const clash = state.schedules.filter((s) =>
    s.id !== state.editingId && s.day === day &&
    (s.teacher === teacher || s.meeting_link === link) &&
    toMin(s.start_time) < eMin && toMin(s.end_time) > sMin);

  if (clash.length === 0) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.innerHTML = '<strong>⚠ Berpotensi bentrok</strong><ul>' +
    clash.map((c) => `<li>${escapeHtml(c.subject)} — ${escapeHtml(c.teacher)} (${hhmm(c.start_time)}–${hhmm(c.end_time)})</li>`).join('') +
    '</ul>';
}

async function save() {
  const body = {
    subject: $('#fSubject').value.trim(),
    teacher: $('#fTeacher').value.trim(),
    meeting_link: $('#fLink').value.trim(),
    day: $('#fDay').value,
    start_time: $('#fStart').value + ':00',
    end_time: $('#fEnd').value + ':00',
  };
  $('#formError').hidden = true;
  const isEdit = !!state.editingId;
  const path = isEdit ? '/schedules/' + state.editingId : '/schedules';
  const method = isEdit ? 'PUT' : 'POST';

  const r = await api(path, { method, body });

  if (r.status === 400) {
    const e = $('#formError'); e.hidden = false;
    e.innerHTML = '<strong>Validasi gagal</strong><ul>' +
      (r.data.errors || [r.data.message]).map((m) => `<li>${escapeHtml(m)}</li>`).join('') + '</ul>';
    return;
  }
  if (r.status === 409) {
    const hint = $('#conflictHint'); hint.hidden = false;
    hint.innerHTML = '<strong>Ditolak server: jadwal bentrok</strong><ul>' +
      (r.data.conflicting_schedules || []).map((c) =>
        `<li>${escapeHtml(c.subject)} — ${escapeHtml(c.teacher)} (${hhmm(c.start_time)}–${hhmm(c.end_time)})</li>`).join('') + '</ul>';
    return;
  }
  if (r.status === 403) { toast('Akses ditolak', r.data.message, 'err'); return; }
  if (!r.ok) { toast('Gagal', r.data.message || 'Terjadi kesalahan.', 'err'); return; }

  closeModal();
  toast(isEdit ? 'Jadwal diperbarui' : 'Jadwal ditambahkan',
    body.subject + ' · ' + body.day + ' ' + hhmm(body.start_time), 'ok');
  loadSchedules();
}

/* ---------- Hapus ---------- */
function openConfirm(id) {
  const s = state.schedules.find((x) => x.id === id);
  state.deleteId = id;
  $('#confirmText').textContent = `“${s.subject}” (${s.day}, ${hhmm(s.start_time)}–${hhmm(s.end_time)}) akan dihapus.`;
  $('#confirm').hidden = false;
}
async function doDelete() {
  const r = await api('/schedules/' + state.deleteId, { method: 'DELETE' });
  $('#confirm').hidden = true;
  if (!r.ok) { toast('Gagal menghapus', r.data.message || '', 'err'); return; }
  toast('Jadwal dihapus', 'Data berhasil dihapus.', 'ok');
  loadSchedules();
}

/* ---------- Publikasi ---------- */
async function publish(id) {
  const r = await api('/schedules/' + id + '/publish', { method: 'PUT' });
  if (!r.ok) { toast('Gagal', r.data.message || '', 'err'); return; }
  toast('Jadwal dipublikasikan', 'Sekarang tampil untuk siswa & guru.', 'ok');
  loadSchedules();
}

/* =====================================================================
   EVENT BINDING
   ===================================================================== */
function bind() {
  // Login
  $('#loginBtn').onclick = () => doLogin($('#loginUser').value.trim(), $('#loginPass').value);
  $('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });
  document.querySelectorAll('.chip').forEach((c) => c.onclick = () => {
    $('#loginUser').value = c.dataset.u; $('#loginPass').value = c.dataset.p;
  });

  // Topbar
  $('#logoutBtn').onclick = logout;
  $('#addBtn').onclick = openAdd;
  $('#printBtn').onclick = () => window.print();

  // Pencarian (debounce)
  let timer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = e.target.value.trim(); loadSchedules(); }, 300);
  });

  // Toggle tampilan
  document.querySelectorAll('.seg__btn').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.seg__btn').forEach((x) => x.classList.remove('is-active'));
    b.classList.add('is-active');
    state.view = b.dataset.view;
    render();
  });

  // Modal
  $('#saveBtn').onclick = save;
  document.querySelectorAll('[data-close]').forEach((x) => x.onclick = closeModal);
  ['#fTeacher', '#fLink', '#fDay', '#fStart', '#fEnd'].forEach((sel) =>
    $(sel).addEventListener('input', checkLiveConflict));

  // Konfirmasi hapus
  $('#confirmDelBtn').onclick = doDelete;
  document.querySelectorAll('[data-confirm-close]').forEach((x) => x.onclick = () => $('#confirm').hidden = true);
}

/* ---------- Mulai ---------- */
bind();
if (state.token && state.user) enterApp();
