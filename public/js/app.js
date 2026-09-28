'use strict';

// Frontend for the schedule service. Talks to the REST API with a Bearer token.

const API_BASE = '/v1';

// Keep in sync with validators/schedule.js and the ENUM in schema.sql.
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Default visible window of the weekly grid, widened when a session falls outside it.
const GRID_START_MIN = 7 * 60;
const GRID_END_MIN = 18 * 60;
const PX_PER_MIN = 1;
const MIN_EVENT_HEIGHT = 34;

const SUBJECT_COLORS = [
  '#6366f1', '#14b8a6', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#22c55e',
];

const STORAGE_TOKEN = 'jbk_token';
const STORAGE_USER = 'jbk_user';

const state = {
  token: null,
  user: null,
  schedules: [],
  view: 'grid',
  query: '',
  loadSeq: 0,
  editingId: null,
  deleteId: null,
  idempotencyKey: null,
  saving: false,
};

const $ = (selector) => document.querySelector(selector);

/* Helpers */

function colorFor(subject) {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

// "HH:MM" or "HH:MM:SS" -> minutes since midnight
function toMinutes(time) {
  const [hours, minutes] = String(time).split(':');
  return Number(hours) * 60 + Number(minutes);
}

function hhmm(time) {
  return String(time).slice(0, 5);
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only http(s) links are rendered as anchors, even if the API ever returns
// something else (e.g. a "javascript:" URL inserted directly into the DB).
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function isAdmin() {
  return state.user?.role === 'admin';
}

// crypto.randomUUID is only available in a secure context (https or localhost).
function newIdempotencyKey() {
  return typeof window.crypto?.randomUUID === 'function' ? window.crypto.randomUUID() : null;
}

/* Session */

function restoreSession() {
  try {
    const token = localStorage.getItem(STORAGE_TOKEN);
    const user = JSON.parse(localStorage.getItem(STORAGE_USER) || 'null');
    if (token && user && typeof user.name === 'string') {
      state.token = token;
      state.user = user;
    }
  } catch {
    clearSession();
  }
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}

/* API */

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const options = { method, headers: { ...headers } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (state.token) {
    options.headers.Authorization = `Bearer ${state.token}`;
  }

  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch {
    return { ok: false, status: 0, data: { message: 'Cannot reach the server.' } };
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response; callers fall back to a generic message.
  }

  // An expired or invalid token affects every screen, so handle it once here.
  if (res.status === 401 && state.token) {
    logout();
    toast('Session expired', 'Please sign in again.', 'err');
  }

  return { ok: res.ok, status: res.status, data };
}

/* Toasts */

function toast(title, message = '', type = 'info') {
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  $('#toasts').appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s';
    node.style.opacity = '0';
  }, 3000);
  setTimeout(() => node.remove(), 3400);
}

/* Login */

async function doLogin(username, password) {
  const button = $('#loginBtn');
  const error = $('#loginError');
  error.hidden = true;
  button.disabled = true;

  const res = await api('/auth/login', { method: 'POST', body: { username, password } });
  button.disabled = false;

  if (!res.ok) {
    error.textContent = res.data.message || 'Sign-in failed.';
    error.hidden = false;
    return;
  }

  saveSession(res.data.data.token, res.data.data.user);
  enterApp();
}

function logout() {
  clearSession();
  closeModal();
  closeConfirm();

  // Drop everything rendered for the previous user, drafts included.
  state.schedules = [];
  state.query = '';
  state.view = 'grid';
  $('#searchInput').value = '';
  document.querySelectorAll('.seg__btn').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === 'grid'));
  $('#stats').innerHTML = '';
  $('#gridView').innerHTML = '';
  $('#listView').innerHTML = '';

  $('#app').hidden = true;
  $('#loginScreen').hidden = false;
  $('#loginUser').value = '';
  $('#loginPass').value = '';
}

function enterApp() {
  $('#loginScreen').hidden = true;
  $('#app').hidden = false;
  $('#userName').textContent = state.user.name;
  $('#userRole').textContent = isAdmin() ? 'Administrator' : 'View only';
  $('#userAvatar').textContent = initials(state.user.name);
  $('#addBtn').hidden = !isAdmin();
  loadSchedules();
}

/* Data */

async function loadSchedules() {
  // Ignore responses that arrive after a newer search was sent.
  const seq = ++state.loadSeq;
  const query = state.query ? `?q=${encodeURIComponent(state.query)}` : '';
  const res = await api(`/schedules${query}`);
  if (seq !== state.loadSeq || res.status === 401) return;

  if (!res.ok) {
    toast('Could not load schedules', res.data.message || 'Something went wrong.', 'err');
    return;
  }
  state.schedules = res.data.data || [];
  renderStats();
  render();
}

function renderStats() {
  const all = state.schedules;
  const teachers = new Set(all.map((s) => s.teacher)).size;

  let cards;
  if (isAdmin()) {
    const published = all.filter((s) => s.published).length;
    cards = [
      { value: all.length, label: 'Total Sessions', color: 'var(--primary)' },
      { value: published, label: 'Published', color: 'var(--ok)' },
      { value: all.length - published, label: 'Drafts', color: 'var(--warn)' },
      { value: teachers, label: 'Teachers', color: 'var(--accent)' },
    ];
  } else {
    // Viewers only receive published schedules, so draft counts mean nothing here.
    cards = [
      { value: all.length, label: 'Total Sessions', color: 'var(--primary)' },
      { value: new Set(all.map((s) => s.subject)).size, label: 'Subjects', color: 'var(--ok)' },
      { value: teachers, label: 'Teachers', color: 'var(--accent)' },
      { value: new Set(all.map((s) => s.day)).size, label: 'Active Days', color: 'var(--warn)' },
    ];
  }

  $('#stats').innerHTML = cards.map((card) => `
    <div class="stat">
      <span class="stat__bar" style="background:${card.color}"></span>
      <div class="stat__num">${Number(card.value)}</div>
      <div class="stat__lbl">${escapeHtml(card.label)}</div>
    </div>`).join('');
}

function render() {
  const grid = state.view === 'grid';
  $('#gridView').hidden = !grid;
  $('#listView').hidden = grid;
  if (grid) renderGrid();
  else renderList();
}

/* Weekly grid */

function renderGrid() {
  const board = $('#gridView');
  if (state.schedules.length === 0) {
    const hint = isAdmin() ? 'Click "Add Schedule" to create the first one.' : 'No schedules have been published yet.';
    board.innerHTML = `<div class="board__empty"><strong>No schedules yet</strong>${hint}</div>`;
    return;
  }

  // Monday to Friday are always shown; Saturday only when it has sessions.
  const usedDays = new Set(state.schedules.map((s) => s.day));
  const columns = DAYS.filter((day, index) => index < 5 || usedDays.has(day));

  let gridStart = GRID_START_MIN;
  let gridEnd = GRID_END_MIN;
  state.schedules.forEach((s) => {
    gridStart = Math.min(gridStart, Math.floor(toMinutes(s.start_time) / 60) * 60);
    gridEnd = Math.max(gridEnd, Math.ceil(toMinutes(s.end_time) / 60) * 60);
  });
  const bodyHeight = (gridEnd - gridStart) * PX_PER_MIN;
  const admin = isAdmin();

  let head = '<div class="timetable__corner"></div>';
  columns.forEach((day) => {
    const count = state.schedules.filter((s) => s.day === day).length;
    head += `<div class="timetable__day">${escapeHtml(day)}<small>${count} ${count === 1 ? 'session' : 'sessions'}</small></div>`;
  });

  let rail = '';
  for (let m = gridStart; m <= gridEnd; m += 60) {
    const label = `${String(m / 60).padStart(2, '0')}:00`;
    rail += `<div class="timerail__mark" style="top:${(m - gridStart) * PX_PER_MIN}px">${label}</div>`;
  }

  let cells = `<div class="timerail" style="height:${bodyHeight}px">${rail}</div>`;
  columns.forEach((day) => {
    const events = state.schedules
      .filter((s) => s.day === day)
      .map((s) => ({ ...s, startMin: toMinutes(s.start_time), endMin: toMinutes(s.end_time) }));
    layoutLanes(events);

    let hourLines = '';
    for (let m = gridStart + 60; m < gridEnd; m += 60) {
      hourLines += `<div class="daycol__hour" style="top:${(m - gridStart) * PX_PER_MIN}px"></div>`;
    }

    const eventHtml = events.map((ev) => {
      const top = (ev.startMin - gridStart) * PX_PER_MIN;
      const height = Math.max(MIN_EVENT_HEIGHT, (ev.endMin - ev.startMin) * PX_PER_MIN - 4);
      const width = 100 / ev.laneCount;
      return `
        <div class="event ${admin ? 'is-admin' : ''}"
             style="top:${top}px;height:${height}px;left:calc(${ev.lane * width}% + 4px);width:calc(${width}% - 8px);right:auto;background:${colorFor(ev.subject)}"
             data-id="${Number(ev.id)}">
          ${ev.published ? '' : '<span class="event__draft">DRAFT</span>'}
          <div class="event__subj">${escapeHtml(ev.subject)}</div>
          <div class="event__meta">Online · ${escapeHtml(ev.teacher)}</div>
          <div class="event__time">${escapeHtml(hhmm(ev.start_time))}–${escapeHtml(hhmm(ev.end_time))}</div>
        </div>`;
    }).join('');

    cells += `<div class="daycol" style="height:${bodyHeight}px">${hourLines}${eventHtml}</div>`;
  });

  board.innerHTML = `
    <div class="timetable" style="--cols:${columns.length}">
      <div class="timetable__head">${head}</div>
      <div class="timetable__body">${cells}</div>
    </div>`;

  if (admin) {
    board.querySelectorAll('.event.is-admin').forEach((node) =>
      node.addEventListener('click', () => openEdit(Number(node.dataset.id))));
  }
}

// Places overlapping events side by side. Overlaps between different teachers
// and links are allowed, so the grid has to handle them.
function layoutLanes(events) {
  events.sort((a, b) => a.startMin - b.startMin);
  const laneEnds = [];
  events.forEach((ev) => {
    const free = laneEnds.findIndex((end) => ev.startMin >= end);
    ev.lane = free === -1 ? laneEnds.length : free;
    laneEnds[ev.lane] = ev.endMin;
  });
  const laneCount = Math.max(1, laneEnds.length);
  events.forEach((ev) => { ev.laneCount = laneCount; });
}

/* List view */

function renderList() {
  const wrap = $('#listView');
  if (state.schedules.length === 0) {
    wrap.innerHTML = '<div class="listwrap__empty"><strong>No schedules found</strong>Try a different search term.</div>';
    return;
  }

  const admin = isAdmin();
  const rows = state.schedules.map((s) => {
    const id = Number(s.id);
    const url = safeUrl(s.meeting_link);
    const link = url
      ? `<a class="linkcell" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Join class ↗</a>`
      : '<span class="timecell">Invalid link</span>';
    const badge = s.published
      ? '<span class="badge badge--ok">Published</span>'
      : '<span class="badge badge--draft">Draft</span>';
    const actions = `
      <div class="rowactions">
        ${s.published ? '' : `<button class="iconbtn iconbtn--pub" data-pub="${id}">Publish</button>`}
        <button class="iconbtn" data-edit="${id}">Edit</button>
        <button class="iconbtn iconbtn--del" data-del="${id}">Delete</button>
      </div>`;

    return `
      <tr>
        <td><div class="subjcell"><span class="subjdot" style="background:${colorFor(s.subject)}"></span>
          <span><strong>${escapeHtml(s.subject)}</strong><small>${escapeHtml(s.teacher)}</small></span></div></td>
        <td>${link}</td>
        <td><span class="daypill">${escapeHtml(s.day)}</span></td>
        <td class="timecell">${escapeHtml(hhmm(s.start_time))} – ${escapeHtml(hhmm(s.end_time))}</td>
        ${admin ? `<td>${badge}</td><td>${actions}</td>` : ''}
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>Subject</th><th>Class Link</th><th>Day</th><th>Time</th>
        ${admin ? '<th>Status</th><th style="text-align:right">Actions</th>' : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  if (admin) {
    wrap.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openEdit(Number(b.dataset.edit)); });
    wrap.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => openConfirm(Number(b.dataset.del)); });
    wrap.querySelectorAll('[data-pub]').forEach((b) => { b.onclick = () => publish(Number(b.dataset.pub)); });
  }
}

/* Add / edit modal */

function fillForm({ subject = '', teacher = '', meeting_link = '', day = 'Monday', start = '08:00', end = '09:30' }) {
  $('#fSubject').value = subject;
  $('#fTeacher').value = teacher;
  $('#fLink').value = meeting_link;
  $('#fDay').value = day;
  $('#fStart').value = start;
  $('#fEnd').value = end;
  $('#conflictHint').hidden = true;
  $('#formError').hidden = true;
}

function openAdd() {
  state.editingId = null;
  // One key per form: a double click or a retried request cannot create two rows.
  state.idempotencyKey = newIdempotencyKey();
  $('#modalTitle').textContent = 'Add Schedule';
  fillForm({});
  $('#modal').hidden = false;
  checkLiveConflict();
}

function openEdit(id) {
  const s = state.schedules.find((item) => item.id === id);
  if (!s) return;
  state.editingId = id;
  state.idempotencyKey = null;
  $('#modalTitle').textContent = 'Edit Schedule';
  fillForm({ ...s, start: hhmm(s.start_time), end: hhmm(s.end_time) });
  $('#modal').hidden = false;
  checkLiveConflict();
}

function closeModal() {
  $('#modal').hidden = true;
}

function conflictList(items) {
  return items.map((c) =>
    `<li>${escapeHtml(c.subject)} — ${escapeHtml(c.teacher)} (${escapeHtml(hhmm(c.start_time))}–${escapeHtml(hhmm(c.end_time))})</li>`,
  ).join('');
}

// Early warning based on the data already loaded. The server still decides.
function checkLiveConflict() {
  const teacher = $('#fTeacher').value.trim();
  const link = $('#fLink').value.trim();
  const day = $('#fDay').value;
  const start = $('#fStart').value;
  const end = $('#fEnd').value;
  const hint = $('#conflictHint');

  if (!teacher || !link || !start || !end || start >= end) {
    hint.hidden = true;
    return;
  }

  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  const clashes = state.schedules.filter((s) =>
    s.id !== state.editingId &&
    s.day === day &&
    (s.teacher === teacher || s.meeting_link === link) &&
    toMinutes(s.start_time) < endMin &&
    toMinutes(s.end_time) > startMin);

  if (clashes.length === 0) {
    hint.hidden = true;
    return;
  }
  hint.innerHTML = `<strong>Possible conflict</strong><ul>${conflictList(clashes)}</ul>`;
  hint.hidden = false;
}

async function save() {
  if (state.saving) return;

  const body = {
    subject: $('#fSubject').value.trim(),
    teacher: $('#fTeacher').value.trim(),
    meeting_link: $('#fLink').value.trim(),
    day: $('#fDay').value,
    start_time: $('#fStart').value,
    end_time: $('#fEnd').value,
  };
  const isEdit = state.editingId !== null;
  const headers = !isEdit && state.idempotencyKey ? { 'Idempotency-Key': state.idempotencyKey } : {};

  $('#formError').hidden = true;
  state.saving = true;
  $('#saveBtn').disabled = true;

  const res = await api(isEdit ? `/schedules/${state.editingId}` : '/schedules', {
    method: isEdit ? 'PUT' : 'POST',
    body,
    headers,
  });

  state.saving = false;
  $('#saveBtn').disabled = false;

  if (res.status === 401) return;

  if (res.status === 400) {
    const messages = res.data.errors || [res.data.message || 'Invalid data.'];
    const error = $('#formError');
    error.innerHTML = `<strong>Validation failed</strong><ul>${messages.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`;
    error.hidden = false;
    return;
  }
  if (res.status === 409) {
    const hint = $('#conflictHint');
    const items = res.data.conflicting_schedules || [];
    hint.innerHTML = items.length > 0
      ? `<strong>Rejected by the server: schedule conflict</strong><ul>${conflictList(items)}</ul>`
      : `<strong>${escapeHtml(res.data.message || 'Schedule conflict.')}</strong>`;
    hint.hidden = false;
    return;
  }
  if (!res.ok) {
    toast(res.status === 403 ? 'Access denied' : 'Save failed', res.data.message || 'Something went wrong.', 'err');
    return;
  }

  closeModal();
  toast(isEdit ? 'Schedule updated' : 'Schedule added', `${body.subject} · ${body.day} ${body.start_time}`, 'ok');
  loadSchedules();
}

/* Delete */

function openConfirm(id) {
  const s = state.schedules.find((item) => item.id === id);
  if (!s) return;
  state.deleteId = id;
  $('#confirmText').textContent = `"${s.subject}" (${s.day}, ${hhmm(s.start_time)}–${hhmm(s.end_time)}) will be deleted.`;
  $('#confirm').hidden = false;
}

function closeConfirm() {
  $('#confirm').hidden = true;
  state.deleteId = null;
}

async function doDelete() {
  if (state.deleteId === null) return;
  const res = await api(`/schedules/${state.deleteId}`, { method: 'DELETE' });
  closeConfirm();
  if (res.status === 401) return;
  if (!res.ok) {
    toast('Delete failed', res.data.message || 'Something went wrong.', 'err');
    return;
  }
  toast('Schedule deleted', 'The schedule has been removed.', 'ok');
  loadSchedules();
}

/* Publish */

async function publish(id) {
  const res = await api(`/schedules/${id}/publish`, { method: 'PUT' });
  if (res.status === 401) return;
  if (!res.ok) {
    toast('Publish failed', res.data.message || 'Something went wrong.', 'err');
    return;
  }
  toast('Schedule published', 'Students and teachers can now see it.', 'ok');
  loadSchedules();
}

/* Event binding */

function bind() {
  const submitLogin = () => doLogin($('#loginUser').value.trim(), $('#loginPass').value);
  $('#loginBtn').onclick = submitLogin;
  ['#loginUser', '#loginPass'].forEach((selector) =>
    $(selector).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); }));
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => {
      $('#loginUser').value = chip.dataset.u;
      $('#loginPass').value = chip.dataset.p;
    };
  });

  $('#logoutBtn').onclick = logout;
  $('#addBtn').onclick = openAdd;
  $('#printBtn').onclick = () => window.print();

  let searchTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      loadSchedules();
    }, 300);
  });

  document.querySelectorAll('.seg__btn').forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll('.seg__btn').forEach((b) => b.classList.remove('is-active'));
      button.classList.add('is-active');
      state.view = button.dataset.view;
      render();
    };
  });

  $('#saveBtn').onclick = save;
  document.querySelectorAll('[data-close]').forEach((node) => { node.onclick = closeModal; });
  ['#fTeacher', '#fLink', '#fDay', '#fStart', '#fEnd'].forEach((selector) =>
    $(selector).addEventListener('input', checkLiveConflict));

  $('#confirmDelBtn').onclick = doDelete;
  document.querySelectorAll('[data-confirm-close]').forEach((node) => { node.onclick = closeConfirm; });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModal();
    closeConfirm();
  });
}

bind();
restoreSession();
if (state.token && state.user) enterApp();
