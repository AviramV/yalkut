'use strict';

/* מארגן הילקוט — no dependencies, no build step, no network at runtime. */

const STORE_WEEK  = 'yalkut.week.v1';
const STORE_TODAY = 'yalkut.today.v1';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const DAY_SHORT = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'"];

let DATA = null;
const subjectById = new Map();
const itemById = new Map();
const groupById = new Map();

let activeIds = [];   // subject ids, in the order they appear in the text
let week = {};        // { "0".."5": "שפה, חשבון" }
let checked = {};     // { instanceKey: true }
let selectedDay = 0;  // 0=Sunday … 5=Friday

const $ = (id) => document.getElementById(id);

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* The day being packed for. In the evening that's tomorrow — launch analytics
   showed half the evening visitors tapping over to the next day by hand.
   ponytail: one fixed cutoff hour; tune EVENING_HOUR if parents pack earlier. */
const EVENING_HOUR = 17;

function packDate(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() >= EVENING_HOUR) d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 1);   // Saturday has no school
  return d;
}

function schoolDay(now = new Date()) {
  return packDate(now).getDay();   // 0=Sun … 5=Fri
}

function packLabel(now = new Date()) {
  const ahead = Math.round((new Date(dateKey(packDate(now))) - new Date(dateKey(now))) / 864e5);
  return ahead === 0 ? 'היום' : ahead === 1 ? 'מחר' : 'יום הלימודים הבא';
}

/* ---------------- storage ----------------
   State is stamped with the date being packed for, so last night's ticks are
   still there in the morning, and yesterday's never carry over.
   ponytail: the rollover happens on load, not at midnight. A tab left open
   overnight keeps yesterday's key until reload. Add a timer if that bites. */

function loadToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_TODAY) || '{}');
    if (raw.date !== dateKey(packDate())) return null;
    return raw;
  } catch { return null; }
}

function saveToday() {
  try {
    localStorage.setItem(STORE_TODAY, JSON.stringify({
      date: dateKey(packDate()),
      day: selectedDay,
      text: $('pasteInput').value,
      subjects: activeIds,
      checked,
    }));
  } catch { /* private mode or full quota — the app still works, just forgets */ }
}

function loadWeek() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_WEEK) || 'null');
    if (raw && typeof raw === 'object') return { ...DATA.defaultWeekly, ...raw };
  } catch { /* fall through to the shipped default */ }
  return { ...DATA.defaultWeekly };
}

function saveWeek() {
  try { localStorage.setItem(STORE_WEEK, JSON.stringify(week)); return true; }
  catch { return false; }
}

/* ---------------- subject matching ----------------
   Longest keyword first, and each match is blanked out so a longer subject
   name swallows the shorter one inside it ("אנגלית אומנותית" ≠ "אנגלית").
   indexOf + a manual boundary check, deliberately not regex lookbehind:
   lookbehind throws on iOS Safari < 16.4 and would take the whole app down. */

const HEBREW_LETTER = /[א-ת]/;

function findAll(hay, needle) {
  const hits = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = i > 0 ? hay[i - 1] : ' ';
    const after = hay[i + needle.length] ?? ' ';
    if (!HEBREW_LETTER.test(before) && !HEBREW_LETTER.test(after)) hits.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return hits;
}

function matchSubjects(text) {
  if (!text || !text.trim()) return [];

  const rules = [];
  for (const s of DATA.subjects) {
    for (const kw of s.keywords) rules.push({ kw: kw.toLowerCase(), id: s.id });
  }
  rules.sort((a, b) => b.kw.length - a.kw.length);

  let hay = text.toLowerCase();
  const firstSeenAt = new Map();

  for (const rule of rules) {
    const hits = findAll(hay, rule.kw);
    if (!hits.length) continue;

    const prev = firstSeenAt.get(rule.id);
    if (prev === undefined || hits[0] < prev) firstSeenAt.set(rule.id, hits[0]);

    const chars = hay.split('');
    for (const p of hits) for (let k = 0; k < rule.kw.length; k++) chars[p + k] = ' ';
    hay = chars.join('');
  }

  return [...firstSeenAt.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/* ---------------- the packing list ----------------
   One row per physical object to put in the bag.
   shared:true  → one row, listing every subject that needs it.
   shared:false → one row per subject, because those are separate objects
                  even when they look identical. */

function buildInstances() {
  const out = [];
  const sharedSeen = new Map();

  for (const sid of activeIds) {
    const subject = subjectById.get(sid);
    if (!subject) continue;

    for (const itemId of subject.items) {
      const item = itemById.get(itemId);
      if (!item) continue;

      if (item.shared) {
        const existing = sharedSeen.get(itemId);
        if (existing) { existing.subjects.push(subject.name); continue; }
        const inst = { key: itemId, item, subjects: [subject.name] };
        sharedSeen.set(itemId, inst);
        out.push(inst);
      } else {
        out.push({ key: `${itemId}@${sid}`, item, subjects: [subject.name] });
      }
    }
  }
  return out;
}

function coverOf(item) {
  return item.cover ? DATA.covers[item.cover] : null;
}

function rowHtml(inst) {
  const cover = coverOf(inst.item);
  const isPacked = !!checked[inst.key];
  const tags = [];
  if (cover) {
    tags.push(`<span class="cover-tag" style="--tag-bg:${esc(cover.dot)}33;--tag-ink:var(--ink)">${esc(cover.label)}</span>`);
  }

  return `
    <label class="row${isPacked ? ' packed' : ''}" style="--spine:${esc(cover ? cover.dot : '#D9D6CE')}">
      <input type="checkbox" data-key="${esc(inst.key)}"${isPacked ? ' checked' : ''}>
      <span class="row-body">
        <span class="row-name">${esc(inst.item.name)}</span>
        <span class="row-for">${esc(inst.subjects.join(' · '))}</span>
        ${tags.length ? `<span class="row-tags">${tags.join('')}</span>` : ''}
      </span>
    </label>`;
}

/* ---------------- rendering ---------------- */

function render() {
  const instances = buildInstances();

  renderHeader(instances);
  renderItems(instances);
  renderChips();
  renderProgress(instances);
  saveToday();

  function renderItems(list) {
    const host = $('itemList');
    const empty = $('emptyState');

    if (!list.length) {
      host.innerHTML = '';
      empty.hidden = false;
      $('emptyState').querySelector('.empty-title').textContent =
        activeIds.length ? 'המקצועות של היום לא דורשים ציוד מיוחד' : 'אין מקצועות ליום הזה';
      return;
    }
    empty.hidden = true;

    let html = '';
    for (const group of DATA.groups) {
      const inGroup = list.filter((i) => i.item.group === group.id);
      if (!inGroup.length) continue;
      html += `<div class="group-head"><span aria-hidden="true">${esc(group.icon)}</span>`
            + `<span>${esc(group.label)}</span><hr></div>`;
      html += inGroup.map((i) => rowHtml(i)).join('');
    }

    // Subject notes from the school list ("2 מחברות אדומות", water on sport days).
    const notes = activeIds
      .map((id) => subjectById.get(id))
      .filter((s) => s && s.note && s.items.length)
      .map((s) => `<p class="note"><b>${esc(s.name)}:</b> ${esc(s.note)}</p>`);
    if (notes.length) html += `<div style="margin-top:14px">${notes.join('')}</div>`;

    host.innerHTML = html;
  }
}

function renderHeader(instances) {
  $('dayTitle').textContent = `יום ${DAY_NAMES[selectedDay]}`;

  const names = activeIds.map((id) => subjectById.get(id)?.name).filter(Boolean);
  const isToday = selectedDay === schoolDay();
  $('dayMeta').textContent = isToday ? packLabel() : 'יום אחר במערכת';

  $('subjectsLine').innerHTML = names.length
    ? `<b>${names.length} מקצועות:</b> ${esc(names.join(', '))}`
    : 'לא נבחרו מקצועות ליום הזה.';

  for (const btn of $('dayButtons').children) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.day) === selectedDay));
  }
}

let wasReady = null;   // null until the first render, so a resumed full bag stays quiet
function renderProgress(instances) {
  const total = instances.length + DATA.pencilCase.length + DATA.fixedBag.length;
  const keys = [
    ...instances.map((i) => i.key),
    ...DATA.pencilCase.map((_, i) => `pencil:${i}`),
    ...DATA.fixedBag.map((_, i) => `bag:${i}`),
  ];
  const done = keys.filter((k) => checked[k]).length;

  const strip = $('strip');
  if (strip.children.length !== total) {
    strip.innerHTML = '<span class="cell"></span>'.repeat(total);
  }
  [...strip.children].forEach((cell, i) => cell.classList.toggle('on', i < done));
  strip.classList.toggle('full', total > 0 && done === total);

  const allPacked = total > 0 && done === total;
  if (allPacked && wasReady === false) track('bag_ready', { items: total, day: selectedDay });
  wasReady = allPacked;
  const countEl = $('countText');
  countEl.textContent = allPacked ? 'הכול נארז' : `${done} מתוך ${total} נארזו`;
  countEl.classList.toggle('done', allPacked);
  $('readyBanner').hidden = !allPacked;
}

function renderChips() {
  const host = $('subjectChips');
  const active = new Set(activeIds);
  host.innerHTML = DATA.subjects.map((s) => {
    const firstCover = s.items.map((id) => coverOf(itemById.get(id) || {})).find(Boolean);
    const dot = firstCover
      ? `<span class="chip-dot" style="background:${esc(firstCover.dot)}"></span>` : '';
    return `<button class="chip" data-subject="${s.id}" aria-pressed="${active.has(s.id)}">`
         + `<span>${esc(s.name)}</span>${dot}</button>`;
  }).join('');
}

function renderFixedLists() {
  const build = (arr, prefix) => arr.map((entry, i) => {
    const key = `${prefix}:${i}`;
    const on = !!checked[key];
    return `<li><label class="${on ? 'packed' : ''}">`
         + `<input type="checkbox" data-key="${key}"${on ? ' checked' : ''}>`
         + `<span class="list-icon" aria-hidden="true">${esc(entry.icon)}</span>`
         + `<span>${esc(entry.text)}</span></label></li>`;
  }).join('');

  $('pencilList').innerHTML = build(DATA.pencilCase, 'pencil');
  $('bagList').innerHTML = build(DATA.fixedBag, 'bag');
}

function renderWeek() {
  $('weekGrid').innerHTML = DAY_NAMES.map((name, i) => `
    <div class="week-day">
      <div class="week-name">יום ${esc(name)}</div>
      <label class="sr-only" for="week_${i}">מקצועות ביום ${esc(name)}</label>
      <textarea id="week_${i}" data-day="${i}" rows="3"
        placeholder="מקצועות, מופרדים בפסיק">${esc(week[i] || '')}</textarea>
    </div>`).join('');
}

function renderCatalog(query = '') {
  const q = query.trim().toLowerCase();
  const match = (s) => !q
    || s.name.toLowerCase().includes(q)
    || s.keywords.some((k) => k.toLowerCase().includes(q))
    || s.items.some((id) => (itemById.get(id)?.name || '').toLowerCase().includes(q));

  const list = DATA.subjects.filter(match);
  $('catalogSub').textContent =
    `${DATA.subjects.length} מקצועות לפי דף הציוד של בית הספר.`;

  if (!list.length) {
    $('catalogGrid').innerHTML =
      '<div class="empty"><div class="empty-title">לא נמצא ציוד מתאים</div>'
      + '<div class="empty-body">נסו מילה אחרת, למשל "קלסר" או "מדעים".</div></div>';
    return;
  }

  $('catalogGrid').innerHTML = list.map((s) => {
    const items = s.items.map((id) => {
      const item = itemById.get(id);
      if (!item) return '';
      const cover = coverOf(item);
      const dot = `<span class="chip-dot" style="background:${esc(cover ? cover.dot : '#E8E6E0')}"></span>`;
      return `<li>${dot}<span>${esc(item.name)}${cover ? ' · ' + esc(cover.label) : ''}</span></li>`;
    }).join('');

    return `<div class="cat-card">
      <div class="cat-name">${esc(s.name)}</div>
      ${items ? `<ul class="cat-items">${items}</ul>`
              : '<ul class="cat-items"><li><span>ללא ציוד</span></li></ul>'}
      ${s.note ? `<p class="note" style="margin-top:8px">${esc(s.note)}</p>` : ''}
    </div>`;
  }).join('');
}

/* ---------------- analytics ----------------
   Aptabase. The SDK is vendored in aptabase.js because this app has no build
   step; it loads lazily, so a blocked or offline request never delays the list.
   Only counts, day numbers and subject names leave the device — never the
   pasted WhatsApp message and never a search query. */

let track = () => {};

function startAnalytics() {
  const ready = import('./aptabase.js')
    .then((m) => {
      m.init('A-EU-8415609974', {
        appVersion: DATA?.version ?? '',
        // Anything not served from the published site is debug traffic, so a
        // local test never lands in the real numbers.
        isDebug: !location.hostname.endsWith('github.io'),
      });
      return m;
    })
    .catch(() => null);   // blocked, offline or unsupported — the app runs on

  track = (name, props) => { ready.then((m) => m?.trackEvent(name, props)); };
}

/* ---------------- actions ---------------- */

function selectDay(day, { announce = true } = {}) {
  selectedDay = day;
  const text = week[day] || '';
  $('pasteInput').value = text;
  activeIds = matchSubjects(text);
  render();
  if (announce) toast(`נטענה מערכת יום ${DAY_NAMES[day]}`);
}

function setSubjectsFromText() {
  activeIds = matchSubjects($('pasteInput').value);
  render();
}

function toggleSubject(id) {
  const at = activeIds.indexOf(id);
  track('chip_toggled', {
    action: at === -1 ? 'add' : 'remove',
    subject: subjectById.get(id)?.name ?? String(id),
  });
  if (at === -1) activeIds.push(id); else activeIds.splice(at, 1);
  // The textarea is an input, not the source of truth. Leaving it alone means
  // a chip tap never destroys the message the parent pasted in.
  render();
}

function uncheckAll() {
  track('checks_cleared', { day: selectedDay });
  checked = {};
  renderFixedLists();
  render();
  toast('הסימונים נוקו');
}

let toastTimer;
function toast(msg, action) {
  const host = $('toast');
  $('toastMsg').textContent = msg;
  host.querySelector('.btn')?.remove();

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    host.appendChild(btn);
  }

  host.classList.add('show');
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => host.classList.remove('show'), 2600);
}

function switchTab(name) {
  for (const key of ['today', 'week', 'catalog']) {
    const on = key === name;
    $(`tab-${key}`).setAttribute('aria-selected', String(on));
    $(`view-${key}`).hidden = !on;
  }
}

/* ---------------- wiring ---------------- */

function wire() {
  $('dayButtons').innerHTML = DAY_SHORT.map((label, i) =>
    `<button class="day${i === schoolDay() ? ' today' : ''}" data-day="${i}" `
    + `aria-pressed="false"><span aria-hidden="true">${esc(label)}</span>`
    + `<span class="sr-only">יום ${esc(DAY_NAMES[i])}</span></button>`).join('');

  $('dayButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.day');
    if (!btn) return;
    const day = Number(btn.dataset.day);
    track('day_selected', { day, is_today: day === schoolDay() ? 'yes' : 'no' });
    selectDay(day);
  });

  $('subjectChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (btn) toggleSubject(Number(btn.dataset.subject));
  });

  $('pasteInput').addEventListener('input', setSubjectsFromText);

  // On blur, not on every keystroke. matched:0 with chars>0 is the signal that
  // the keyword list missed something a parent actually pasted.
  $('pasteInput').addEventListener('change', (e) => {
    const chars = e.target.value.trim().length;
    if (chars) track('subjects_matched', { chars, matched: activeIds.length });
  });

  $('btnClearSubjects').addEventListener('click', () => {
    $('pasteInput').value = '';
    activeIds = [];
    render();
  });

  // One handler for every checkbox in the app.
  document.addEventListener('change', (e) => {
    const box = e.target;
    if (box.type !== 'checkbox' || !box.dataset.key) return;

    if (box.checked) checked[box.dataset.key] = true;
    else delete checked[box.dataset.key];

    box.closest('.row')?.classList.toggle('packed', box.checked);
    box.closest('label')?.classList.toggle('packed', box.checked);
    renderProgress(buildInstances());
    saveToday();
  });

  $('btnUncheck').addEventListener('click', uncheckAll);

  for (const key of ['today', 'week', 'catalog']) {
    $(`tab-${key}`).addEventListener('click', () => { track('tab_view', { tab: key }); switchTab(key); });
  }

  // Weekly edits save on blur, so switching tabs can't quietly discard them.
  $('weekGrid').addEventListener('blur', (e) => {
    if (e.target.dataset.day === undefined) return;
    week[e.target.dataset.day] = e.target.value;
    saveWeek();
  }, true);

  $('btnSaveWeek').addEventListener('click', () => {
    for (const ta of $('weekGrid').querySelectorAll('textarea')) week[ta.dataset.day] = ta.value;
    const ok = saveWeek();
    track('week_saved', {
      ok: ok ? 'yes' : 'no',
      days_filled: Object.values(week).filter((v) => (v || '').trim()).length,
    });
    toast(ok ? 'המערכת נשמרה' : 'לא הצלחנו לשמור. בדפדפן פרטי השמירה מושבתת.');
    if (week[selectedDay] !== undefined) selectDay(selectedDay, { announce: false });
  });

  $('btnResetWeek').addEventListener('click', () => {
    track('week_reset');
    week = { ...DATA.defaultWeekly };
    renderWeek();
    saveWeek();
    selectDay(selectedDay, { announce: false });
    toast('חזרנו למערכת לדוגמה');
  });

  $('catalogSearch').addEventListener('input', (e) => renderCatalog(e.target.value));

  // The query itself stays on the device; only whether it found anything travels.
  $('catalogSearch').addEventListener('change', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const hits = DATA.subjects.filter((s) =>
      s.name.toLowerCase().includes(q)
      || s.keywords.some((k) => k.toLowerCase().includes(q))
      || s.items.some((id) => (itemById.get(id)?.name || '').toLowerCase().includes(q))).length;
    track('catalog_search', { chars: q.length, hits });
  });
}

/* ---------------- updates ----------------
   A new version never swaps itself in mid-use: it installs quietly, then the
   page offers a refresh. One tap, and only when the parent is ready. */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // A first visit is already the newest version: its worker's clients.claim()
  // fires controllerchange and, on iOS, can race statechange. Only a worker
  // replacing a *different* controller is an update — so a first visit gets
  // no reload flash and no bogus toast, yet a tab left open still hears about
  // the next release.
  const sw = navigator.serviceWorker;
  let controller = sw.controller;

  sw.register('sw.js').then((reg) => {
    const offerReload = (worker) => {
      if (!sw.controller || sw.controller === worker) return;
      track('update_offered');
      toast('יש גרסה חדשה', {
        label: 'רענן',
        onClick: () => { track('update_applied'); worker.postMessage('skip-waiting'); },
      });
    };

    if (reg.waiting) offerReload(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') offerReload(installing);
      });
    });

    // Re-check when the app comes back to the foreground — that's the moment
    // a parent is about to use it, and the cheapest place to catch a release.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* offline or unsupported — the app runs without it */ });

  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    const wasControlled = !!controller;
    controller = sw.controller;
    if (reloading || !wasControlled) return;   // first claim, not an update
    reloading = true;
    location.reload();
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.querySelector('.wrap').innerHTML =
      '<div class="card empty"><span class="empty-mark">📕</span>'
      + '<div class="empty-title">רשימת הציוד לא נטענה</div>'
      + '<div class="empty-body">בדקו חיבור לאינטרנט ורעננו את הדף.</div></div>';
    console.error(err);
    startAnalytics();
    track('data_load_failed', { reason: String(err.message).slice(0, 60) });
    return;
  }

  startAnalytics();

  for (const s of DATA.subjects) subjectById.set(s.id, s);
  for (const i of DATA.items) itemById.set(i.id, i);
  for (const g of DATA.groups) groupById.set(g.id, g);

  $('appTitle').textContent = DATA.title;
  $('appSub').textContent = DATA.subtitle;
  $('appVer').textContent = `v${DATA.version}`;

  week = loadWeek();
  wire();
  renderWeek();
  renderCatalog();

  const saved = loadToday();
  if (saved) {
    selectedDay = Number.isInteger(saved.day) ? saved.day : schoolDay();
    checked = saved.checked || {};
    $('pasteInput').value = saved.text || '';
    activeIds = Array.isArray(saved.subjects)
      ? saved.subjects.filter((id) => subjectById.has(id))
      : matchSubjects($('pasteInput').value);
    renderFixedLists();
    render();
  } else {
    renderFixedLists();
    selectDay(schoolDay(), { announce: false });
  }

  registerServiceWorker();

  track('app_open', {
    day: selectedDay,
    subjects: activeIds.length,
    mode: matchMedia('(display-mode: standalone)').matches ? 'installed' : 'browser',
    resumed: saved ? 'yes' : 'no',
  });
  addEventListener('appinstalled', () => track('pwa_installed'));
}

/* Browser entry point. In node the file is loaded for its pure logic only. */
if (typeof document !== 'undefined') {
  boot();
} else {
  module.exports = {
    matchSubjects,
    buildInstances,
    schoolDay,
    packDate,
    packLabel,
    dateKey,
    load(data) {
      DATA = data;
      subjectById.clear(); itemById.clear();
      for (const s of data.subjects) subjectById.set(s.id, s);
      for (const i of data.items) itemById.set(i.id, i);
    },
    setActive(ids) { activeIds = ids; },
  };
}
