/* 보송함 — 뜨개 도안 보관함 */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
const PDF_OPTS = {
  cMapUrl: 'vendor/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'vendor/pdfjs/standard_fonts/',
};

const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ================= 저장소 (IndexedDB) ================= */
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('bosong', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('patterns')) db.createObjectStore('patterns', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    all: () => run('patterns', 'readonly', s => s.getAll()),
    get: id => run('patterns', 'readonly', s => s.get(id)),
    put: p => run('patterns', 'readwrite', s => s.put(p)),
    getFile: id => run('files', 'readonly', s => s.get(id)),
    putFile: (id, data) => run('files', 'readwrite', s => s.put(data, id)),
    async remove(id) {
      await run('patterns', 'readwrite', s => s.delete(id));
      await run('files', 'readwrite', s => s.delete(id));
    },
  };
})();

/* ================= 공통 UI ================= */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function sheet(title, actions) {
  return new Promise(resolve => {
    const wrap = $('#sheet');
    const box = $('.box', wrap);
    box.innerHTML = '';
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      box.appendChild(h);
    }
    const close = v => { wrap.hidden = true; resolve(v); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.danger) b.className = 'danger';
      b.onclick = () => close(a.value);
      box.appendChild(b);
    }
    const c = document.createElement('button');
    c.className = 'cancel';
    c.textContent = '닫기';
    c.onclick = () => close(null);
    box.appendChild(c);
    wrap.onclick = e => { if (e.target === wrap) close(null); };
    wrap.hidden = false;
  });
}

function loading(on, msg = '불러오는 중…') {
  const l = $('#loading');
  l.textContent = msg;
  l.hidden = !on;
}

/* ================= 보관함 ================= */
let filter = 'all';

function progressOf(p) {
  if (!p.marker || !p.pageCount) return 0;
  return Math.min(1, (p.marker.page + p.marker.y) / p.pageCount);
}

async function renderLibrary() {
  const list = (await DB.all()).sort((a, b) => (b.openedAt || b.createdAt) - (a.openedAt || a.createdAt));
  const shown = list.filter(p => filter === 'all' || (filter === 'done' ? p.done : !p.done));
  const grid = $('#grid');
  grid.innerHTML = '';
  $('#empty').hidden = list.length > 0;
  $('#tabs').hidden = list.length === 0;

  for (const p of shown) {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    const main = p.counters && p.counters[0];
    const subs = [];
    if (p.marker) subs.push(`${p.marker.page + 1} / ${p.pageCount}쪽`);
    else subs.push(`${p.pageCount}쪽`);
    if (main && main.value) subs.push(`${main.name} ${main.value}`);
    card.innerHTML = `
      <div class="thumb"></div>
      <div class="bar"><i style="width:${(p.done ? 1 : progressOf(p)) * 100}%"></i></div>
      <div class="meta"><div class="name"></div><div class="sub"></div></div>
      ${p.done ? '<span class="badge">완성</span>' : ''}
      <button class="more" aria-label="더보기">⋯</button>`;
    if (p.thumb) $('.thumb', card).style.backgroundImage = `url(${p.thumb})`;
    $('.name', card).textContent = p.name;
    $('.sub', card).textContent = subs.join(' · ');
    card.onclick = () => openPattern(p.id);
    $('.more', card).onclick = e => { e.stopPropagation(); patternMenu(p.id); };
    grid.appendChild(card);
  }
  if (list.length && !shown.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-soft);text-align:center;padding:40px 0">
      ${filter === 'done' ? '아직 완성한 작품이 없어요' : '뜨는 중인 도안이 없어요'}</p>`;
  }
}

async function patternMenu(id) {
  const p = await DB.get(id);
  if (!p) return;
  const v = await sheet(p.name, [
    { label: '이름 바꾸기', value: 'rename' },
    { label: p.done ? '다시 뜨는 중으로' : '완성했어요 🎉', value: 'done' },
    { label: '도안 삭제', value: 'delete', danger: true },
  ]);
  if (v === 'rename') {
    const name = prompt('도안 이름', p.name);
    if (name && name.trim()) { p.name = name.trim(); await DB.put(p); }
  } else if (v === 'done') {
    p.done = !p.done;
    await DB.put(p);
    if (p.done) toast('완성 축하해요! 🧶');
  } else if (v === 'delete') {
    if (!confirm(`'${p.name}' 도안을 삭제할까요?\n표시한 위치와 카운트도 함께 지워져요.`)) return;
    await DB.remove(p.id);
  } else return;
  if (current && current.p.id === id) {
    if (v === 'delete') { closeViewer(); return; }
    current.p.name = p.name;
    current.p.done = p.done;
    $('#title').textContent = p.name;
  }
  renderLibrary();
}

async function importFiles(files) {
  if (!files.length) return;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    loading(true, files.length > 1 ? `도안 추가 중… (${i + 1}/${files.length})` : '도안 추가 중…');
    try {
      const buf = await f.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ ...PDF_OPTS, data: new Uint8Array(buf.slice(0)) }).promise;
      const thumb = await makeThumb(doc);
      const id = uid();
      await DB.putFile(id, buf);
      await DB.put({
        id,
        name: f.name.replace(/\.pdf$/i, ''),
        createdAt: Date.now(),
        openedAt: Date.now(),
        pageCount: doc.numPages,
        thumb,
        marker: null,
        counters: [{ id: uid(), name: '단', value: 0 }],
        done: false,
        zoom: 1,
        shade: false,
        scroll: null,
      });
      doc.destroy();
      ok++;
    } catch (err) {
      console.error(err);
      toast(`'${f.name}'을(를) 열 수 없어요`);
    }
  }
  loading(false);
  if (ok) toast(`도안 ${ok}개를 추가했어요`);
  renderLibrary();
}

async function makeThumb(doc) {
  const page = await doc.getPage(1);
  const v0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 360 / v0.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const url = c.toDataURL('image/jpeg', 0.8);
  c.width = c.height = 0;
  return url;
}

/* ================= 도안 보기 ================= */
let current = null; // { p, doc, pages: [{el, canvas, w, h, aspect, rendered, task}], io }
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MAX_CANVAS_PX = 16 * 1024 * 1024 * 0.9; // iOS 캔버스 한도

async function openPattern(id) {
  loading(true);
  try {
    const p = await DB.get(id);
    const data = await DB.getFile(id);
    const doc = await pdfjsLib.getDocument({ ...PDF_OPTS, data: new Uint8Array(data) }).promise;
    p.openedAt = Date.now();
    if (!p.counters || !p.counters.length) p.counters = [{ id: uid(), name: '단', value: 0 }];
    DB.put(p);

    const pagesEl = $('#pages');
    pagesEl.querySelectorAll('.page').forEach(e => e.remove());
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const v = pg.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.i = i - 1;
      el.innerHTML = `<span class="pno">${i}</span>`;
      pagesEl.appendChild(el);
      pages.push({ pg, el, canvas: null, aspect: v.height / v.width, baseW: v.width, task: null, scale: 0, visible: false });
    }
    current = { p, doc, pages, io: null };

    $('#library').hidden = true;
    $('#viewer').hidden = false;
    $('#title').textContent = p.name;
    $('#shade-toggle').classList.toggle('on', !!p.shade);
    renderCounters();

    current.io = new IntersectionObserver(onIntersect, { root: $('#scroller'), rootMargin: '120% 0px' });
    pages.forEach(pg => current.io.observe(pg.el));

    layout();
    restoreScroll();
    keepAwake(true);
  } catch (err) {
    console.error(err);
    toast('도안을 여는 중 문제가 생겼어요');
  } finally {
    loading(false);
  }
}

function closeViewer() {
  if (!current) return;
  saveNow();
  current.io && current.io.disconnect();
  current.pages.forEach(pg => { if (pg.task) pg.task.cancel(); releaseCanvas(pg); });
  current.doc.destroy();
  $('#pages').querySelectorAll('.page').forEach(e => e.remove());
  current = null;
  keepAwake(false);
  $('#viewer').hidden = true;
  $('#library').hidden = false;
  renderLibrary();
}

function pageWidth() {
  const sc = $('#scroller');
  const avail = Math.max(200, sc.clientWidth - 32);
  return Math.round(avail * (current.p.zoom || 1));
}

function layout() {
  if (!current) return;
  const w = pageWidth();
  for (const pg of current.pages) {
    pg.w = w;
    pg.h = Math.round(w * pg.aspect);
    pg.el.style.width = pg.w + 'px';
    pg.el.style.height = pg.h + 'px';
  }
  $('#zoom-label').textContent = Math.round((current.p.zoom || 1) * 100) + '%';
  current.pages.forEach(pg => { if (pg.visible) renderPage(pg); });
  placeMarker();
}

function onIntersect(entries) {
  for (const e of entries) {
    const pg = current && current.pages[+e.target.dataset.i];
    if (!pg) continue;
    pg.visible = e.isIntersecting;
    if (pg.visible) renderPage(pg);
    else releaseCanvas(pg);
  }
}

function releaseCanvas(pg) {
  if (pg.task) { pg.task.cancel(); pg.task = null; }
  if (pg.canvas) { pg.canvas.width = pg.canvas.height = 0; pg.canvas.remove(); pg.canvas = null; }
  pg.scale = 0;
}

async function renderPage(pg) {
  let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  if (pg.w * pg.h * dpr * dpr > MAX_CANVAS_PX) dpr = Math.sqrt(MAX_CANVAS_PX / (pg.w * pg.h));
  const scale = (pg.w / pg.baseW) * dpr;
  if (pg.canvas && Math.abs(pg.scale - scale) < 0.001) return;
  if (pg.task) { pg.task.cancel(); pg.task = null; }
  const vp = pg.pg.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const task = pg.pg.render({ canvasContext: c.getContext('2d'), viewport: vp });
  pg.task = task;
  pg.scale = scale;
  try {
    await task.promise;
  } catch (e) {
    c.width = c.height = 0;
    return; // 취소됨
  }
  if (pg.task !== task) { c.width = c.height = 0; return; }
  pg.task = null;
  if (pg.canvas) { pg.canvas.width = pg.canvas.height = 0; pg.canvas.remove(); }
  pg.canvas = c;
  pg.el.prepend(c);
}

/* ---------- 스크롤 위치 ---------- */
function pageAtY(y) {
  const pages = current.pages;
  for (let i = 0; i < pages.length; i++) {
    const top = pages[i].el.offsetTop;
    const next = i + 1 < pages.length ? pages[i + 1].el.offsetTop : Infinity;
    if (y < next) return { i, frac: Math.max(0, Math.min(1, (y - top) / pages[i].h)) };
  }
  return { i: 0, frac: 0 };
}

function yOf(page, frac) {
  const pg = current.pages[Math.min(page, current.pages.length - 1)];
  return pg.el.offsetTop + frac * pg.h;
}

function restoreScroll() {
  const sc = $('#scroller');
  const s = current.p.scroll;
  if (s) {
    sc.scrollTop = yOf(s.page, s.frac);
    sc.scrollLeft = (s.left || 0) * (sc.scrollWidth - sc.clientWidth);
  } else if (current.p.marker) {
    scrollToMarker(false);
  } else {
    sc.scrollTop = 0;
  }
  updatePageInd();
}

let indTimer;
function updatePageInd() {
  if (!current) return;
  const sc = $('#scroller');
  const { i } = pageAtY(sc.scrollTop + sc.clientHeight / 3);
  const ind = $('#page-ind');
  ind.textContent = `${i + 1} / ${current.pages.length}`;
  ind.style.opacity = 1;
  clearTimeout(indTimer);
  indTimer = setTimeout(() => (ind.style.opacity = 0), 1500);
}

$('#scroller').addEventListener('scroll', () => {
  if (!current) return;
  updatePageInd();
  const sc = $('#scroller');
  const { i, frac } = pageAtY(sc.scrollTop);
  const maxL = sc.scrollWidth - sc.clientWidth;
  current.p.scroll = { page: i, frac, left: maxL > 0 ? sc.scrollLeft / maxL : 0 };
  saveSoon();
}, { passive: true });

/* ---------- 확대/축소 ---------- */
function setZoom(dir) {
  const z = current.p.zoom || 1;
  let idx = ZOOMS.findIndex(v => v >= z - 0.001);
  if (idx < 0) idx = ZOOMS.length - 1;
  idx = Math.max(0, Math.min(ZOOMS.length - 1, idx + dir));
  if (ZOOMS[idx] === z) return;
  const sc = $('#scroller');
  const anchor = pageAtY(sc.scrollTop + sc.clientHeight / 2);
  current.p.zoom = ZOOMS[idx];
  layout();
  sc.scrollTop = yOf(anchor.i, anchor.frac) - sc.clientHeight / 2;
  sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
  saveSoon();
}
$('#zoom-in').onclick = () => setZoom(1);
$('#zoom-out').onclick = () => setZoom(-1);

/* ---------- 진행 표시(형광펜 줄) ---------- */
const DEFAULT_MARK_H = 0.035; // 페이지 폭 대비 줄 높이

function placeMarker() {
  const m = $('#marker');
  const shade = $('#shade');
  const mk = current && current.p.marker;
  if (!mk) {
    m.hidden = true;
    shade.style.height = '0px';
    return;
  }
  const pg = current.pages[Math.min(mk.page, current.pages.length - 1)];
  const h = Math.max(14, (mk.h || DEFAULT_MARK_H) * pg.w);
  const top = pg.el.offsetTop + mk.y * pg.h;
  m.hidden = false;
  m.style.left = pg.el.offsetLeft + 'px';
  m.style.width = pg.w + 'px';
  m.style.top = top + 'px';
  m.style.height = h + 'px';
  shade.style.height = current.p.shade ? top + 'px' : '0px';
}

function setMarkerAtY(y, keepH) {
  const pagesEl = $('#pages');
  y = Math.max(current.pages[0].el.offsetTop, Math.min(y, pagesEl.scrollHeight));
  const { i, frac } = pageAtY(y);
  const old = current.p.marker;
  current.p.marker = { page: i, y: frac, h: (keepH && old && old.h) || (old && old.h) || DEFAULT_MARK_H };
  placeMarker();
  saveSoon();
}

function markerTopY() {
  const mk = current.p.marker;
  return yOf(mk.page, mk.y);
}

function markerPx() {
  const mk = current.p.marker;
  const pg = current.pages[mk.page];
  return Math.max(14, (mk.h || DEFAULT_MARK_H) * pg.w);
}

function scrollToMarker(smooth = true) {
  const sc = $('#scroller');
  if (!current.p.marker) {
    toast('도안을 두 번 톡톡 누르면 그 줄에 표시돼요');
    return;
  }
  const y = markerTopY() - sc.clientHeight * 0.35;
  sc.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
}
$('#goto-marker').onclick = () => scrollToMarker(true);

$('#shade-toggle').onclick = () => {
  current.p.shade = !current.p.shade;
  $('#shade-toggle').classList.toggle('on', current.p.shade);
  placeMarker();
  saveSoon();
  if (current.p.shade && !current.p.marker) toast('먼저 도안을 두 번 톡톡 눌러 위치를 표시해 주세요');
};

// 두 번 톡톡 → 그 위치에 표시
(() => {
  const pagesEl = $('#pages');
  let last = { t: 0, x: 0, y: 0 };
  let down = null;
  pagesEl.addEventListener('pointerdown', e => {
    if (e.target.closest('.marker')) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  pagesEl.addEventListener('pointerup', e => {
    if (!down || e.target.closest('.marker')) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || Date.now() - down.t > 400;
    down = null;
    if (moved) return;
    const now = Date.now();
    if (now - last.t < 380 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
      const rect = pagesEl.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = current.p.marker ? markerPx() : DEFAULT_MARK_H * current.pages[0].w;
      setMarkerAtY(y - h / 2);
      last.t = 0;
    } else {
      last = { t: now, x: e.clientX, y: e.clientY };
    }
  });
})();

// 끌어서 옮기기 / 굵기 조절 / 한 줄씩 이동
(() => {
  const m = $('#marker');
  let drag = null;
  m.addEventListener('pointerdown', e => {
    if (e.target.closest('.grip button')) return;
    e.preventDefault();
    m.setPointerCapture(e.pointerId);
    const resize = !!e.target.closest('.resize');
    drag = { resize, startY: e.clientY, top: markerTopY(), h: markerPx() };
  });
  m.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (drag.resize) {
      const pg = current.pages[current.p.marker.page];
      const h = Math.max(14, Math.min(pg.w * 0.4, drag.h + dy));
      current.p.marker.h = h / pg.w;
      placeMarker();
    } else {
      setMarkerAtY(drag.top + dy, true);
    }
  });
  const end = () => { if (drag) { drag = null; saveSoon(); } };
  m.addEventListener('pointerup', end);
  m.addEventListener('pointercancel', end);

  m.querySelectorAll('[data-nudge]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const dir = +b.dataset.nudge;
      setMarkerAtY(markerTopY() + dir * markerPx(), true);
      // 표시가 화면 밖으로 나가면 따라가기
      const sc = $('#scroller');
      const top = markerTopY();
      if (top < sc.scrollTop + 40 || top > sc.scrollTop + sc.clientHeight - 120) {
        sc.scrollTo({ top: top - sc.clientHeight * 0.35, behavior: 'smooth' });
      }
    });
  });
})();

/* ---------- 카운터 ---------- */
function renderCounters() {
  const wrap = $('#counters');
  wrap.innerHTML = '';
  current.p.counters.forEach((c, idx) => {
    const el = document.createElement('div');
    el.className = 'counter';
    el.innerHTML = `
      <div class="chead">
        <input class="cname" maxlength="20" aria-label="카운터 이름">
        <button class="cmore" aria-label="카운터 메뉴">⋯</button>
      </div>
      <div class="cval"></div>
      <div class="cbtns">
        <button class="minus" aria-label="하나 빼기">−</button>
        <button class="plus" aria-label="하나 더하기">＋</button>
      </div>`;
    const name = $('.cname', el);
    const val = $('.cval', el);
    name.value = c.name;
    val.textContent = c.value;
    name.oninput = () => { c.name = name.value; saveSoon(); };
    name.onkeydown = e => { if (e.key === 'Enter') name.blur(); };
    const bump = d => {
      c.value = Math.max(0, c.value + d);
      val.textContent = c.value;
      val.classList.remove('bump');
      void val.offsetWidth;
      val.classList.add('bump');
      saveSoon();
    };
    $('.plus', el).onclick = () => bump(1);
    $('.minus', el).onclick = () => bump(-1);
    $('.cmore', el).onclick = async () => {
      const acts = [
        { label: '숫자 직접 입력', value: 'set' },
        { label: '0으로 되돌리기', value: 'reset' },
      ];
      if (current.p.counters.length > 1) acts.push({ label: '카운터 삭제', value: 'del', danger: true });
      const v = await sheet(c.name || '카운터', acts);
      if (v === 'set') {
        const n = parseInt(prompt('숫자', c.value), 10);
        if (!isNaN(n) && n >= 0) { c.value = n; val.textContent = n; saveSoon(); }
      } else if (v === 'reset') {
        if (confirm(`'${c.name}' 카운트를 0으로 되돌릴까요?`)) { c.value = 0; val.textContent = 0; saveSoon(); }
      } else if (v === 'del') {
        current.p.counters.splice(idx, 1);
        renderCounters();
        saveSoon();
      }
    };
    wrap.appendChild(el);
  });
}

$('#add-counter').onclick = () => {
  const names = ['코', '무늬', '반복', '줄임', '늘림'];
  const used = new Set(current.p.counters.map(c => c.name));
  const name = names.find(n => !used.has(n)) || `카운터 ${current.p.counters.length + 1}`;
  current.p.counters.push({ id: uid(), name, value: 0 });
  renderCounters();
  saveSoon();
  const panel = $('#panel');
  panel.scrollTo({ top: panel.scrollHeight, left: panel.scrollWidth, behavior: 'smooth' });
};

$('#panel-toggle').onclick = () => {
  const panel = $('#panel');
  panel.hidden = !panel.hidden;
  $('#panel-toggle').classList.toggle('on', !panel.hidden);
  relayoutKeepingPlace();
};

/* ---------- 저장 ---------- */
let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (current) DB.put(current.p).catch(err => console.error(err));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
  else if (current) keepAwake(true);
});
window.addEventListener('pagehide', saveNow);

/* ---------- 화면 꺼짐 방지 ---------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* 지원 안 하는 기기 */ }
}

/* ---------- 화면 회전 / 크기 변경 ---------- */
function relayoutKeepingPlace() {
  if (!current) return;
  const sc = $('#scroller');
  const anchor = pageAtY(sc.scrollTop);
  layout();
  sc.scrollTop = yOf(anchor.i, anchor.frac);
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayoutKeepingPlace, 150);
});

/* ================= 연결 ================= */
$('#file-input').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.filter;
  $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  renderLibrary();
});
$('#back').onclick = closeViewer;
$('#title').onclick = () => current && patternMenu(current.p.id);

renderLibrary();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
