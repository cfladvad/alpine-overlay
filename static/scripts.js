const TEST = {
  currentRunner:   { name: 'ERIKSSON A',  club: 'ARE', bib: '7', time: '1:23.45', position: '2' },
  comparingRunner: { name: 'LINDSTROM B', club: 'UME', bib: '3', time: '1:22.89' },
  diff: '+00:00.56',
};

// ── Client-side timer interpolation ──────────────────────────────────────────
// Rather than waiting for each Firebase update (every 200ms), the browser
// continuously advances the displayed time using requestAnimationFrame and
// resyncs to the authoritative value when a new update arrives.

let _interpBase       = 0;     // centiseconds of last received authoritative time
let _interpReceivedAt = 0;     // Date.now() at the moment of last resync
let _interpRunning    = false;
let _interpRafId      = null;

function _parseCs(t) {
  // Parses M:SS.cc / MM:SS.cc / SS.cc (period or comma decimal) → centiseconds
  if (!t) return 0;
  t = t.trim().replace(',', '.');
  const parts = t.split(':');
  let total = 0;
  for (let i = 0; i < parts.length - 1; i++) total = total * 60 + (parseInt(parts[i], 10) || 0);
  const last = parts[parts.length - 1];
  const dot  = last.indexOf('.');
  if (dot >= 0) {
    total = total * 60 + (parseInt(last.slice(0, dot), 10) || 0);
    total = total * 100 + parseInt(last.slice(dot + 1).padEnd(2, '0').slice(0, 2), 10);
  } else {
    total = (total * 60 + (parseInt(last, 10) || 0)) * 100;
  }
  return total;
}

function _formatCs(cs) {
  cs = Math.max(0, cs);
  const c  = cs % 100;
  let   s  = Math.floor(cs / 100);
  const m  = Math.floor(s / 60);
  s = s % 60;
  const cc = String(c).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return m > 0 ? `${m}:${ss}.${cc}` : `${s}.${cc}`;
}

function _interpTick() {
  if (!_interpRunning) { _interpRafId = null; return; }
  const elapsed = Math.floor((Date.now() - _interpReceivedAt) / 10);
  document.getElementById('currentTime').textContent = _formatCs(_interpBase + elapsed);
  _interpRafId = requestAnimationFrame(_interpTick);
}

function _startInterp(timeStr) {
  _interpBase       = _parseCs(timeStr);
  _interpReceivedAt = Date.now();
  _interpRunning    = true;
  if (_interpRafId === null) _interpRafId = requestAnimationFrame(_interpTick);
}

function _stopInterp(displayTime) {
  _interpRunning = false;
  if (_interpRafId !== null) { cancelAnimationFrame(_interpRafId); _interpRafId = null; }
  document.getElementById('currentTime').textContent = displayTime || '';
}

function applyData(d) {
  // ── Comparing / leader runner ─────────────────────────
  document.getElementById('comparingBib').textContent  = d.comparingRunner.bib;
  document.getElementById('comparingClub').textContent = d.comparingRunner.club;
  document.getElementById('comparingName').textContent = d.comparingRunner.name;
  document.getElementById('comparingTime').textContent = d.comparingRunner.time;

  const leaderBar = document.getElementById('leaderBar');
  const hasLeader = d.comparingRunner.name && d.comparingRunner.name.trim() !== '';
  leaderBar.style.display = hasLeader ? 'flex' : 'none';

  // ── Current runner ────────────────────────────────────
  const hasCurrent = d.currentRunner.name && d.currentRunner.name.trim() !== '';
  document.querySelector('.current-bar').style.display = hasCurrent ? 'flex' : 'none';

  document.getElementById('currentBib').textContent      = d.currentRunner.bib;
  document.getElementById('currentClub').textContent     = d.currentRunner.club;
  document.getElementById('currentName').textContent     = d.currentRunner.name;
  document.getElementById('currentPosition').textContent = d.currentRunner.position || '';

  // ── Running time — interpolate when on course, show static when finished ───
  const onCourse = hasCurrent && !d.currentRunner.position && d.currentRunner.time;
  if (onCourse) {
    _startInterp(d.currentRunner.time);   // resync authoritative value, keep RAF running
  } else {
    _stopInterp(d.currentRunner.time);    // runner finished or no runner — show final time
  }

  // ── Time difference badge ─────────────────────────────
  const diffEl = document.getElementById('timeDifference');
  const diff = d.diff || '';
  diffEl.textContent = diff;
  diffEl.className = 'diff-badge';
  if (diff !== '') {
    diffEl.classList.add(diff[0] === '-' ? 'ahead' : 'behind');
  }
}

// ── Results ───────────────────────────────────────────────────────────────────
let lastResultsVersion = null;
let carouselPage      = 0;
let carouselTimer     = null;
let carouselPageCount = 0;

// Heights must match CSS (px)
const ROW_H   = 46;
const CAT_H   = 43;
const COL_H   = 38;
// Max carousel height before splitting into pages (~75% of 1080 minus header/indicator)
const AVAIL_H = 720;


function formatTime(t) {
  // Strip redundant leading 00: groups: 00:00:39,50 → 39,50 | 00:01:18,42 → 1:18,42
  if (/^\d{2}:\d{2}:\d{2}[,.]/.test(t)) {
    return t.replace(/^(00:)+/, '').replace(/^0(\d)/, '$1');
  }
  return t;
}

function splitPages(items) {
  const pages = [];
  let page = [], usedH = COL_H;
  for (const item of items) {
    const h = item.type === 'category' ? CAT_H : ROW_H;
    if (page.length > 0 && usedH + h > AVAIL_H) {
      pages.push(page);
      page = [];
      usedH = COL_H;
    }
    page.push(item);
    usedH += h;
  }
  if (page.length) pages.push(page);
  return pages;
}

function buildPage(items, headers) {
  const div = document.createElement('div');
  div.className = 'res-page';

  const table = document.createElement('table');
  table.className = 'res-table';

  // Column headers in <thead>
  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');
  for (let i = 0; i < headers.length; i++) {
    const th = document.createElement('th');
    th.className = `res-hdr-cell res-hdr-${i}`;
    th.textContent = headers[i];
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  // Rows in <tbody>
  const tbody = document.createElement('tbody');
  for (const item of items) {
    const tr = document.createElement('tr');
    if (item.type === 'category') {
      tr.className = 'res-cat-row';
      const td = document.createElement('td');
      td.colSpan = headers.length;
      td.textContent = item.name;
      tr.appendChild(td);
    } else {
      tr.className = 'res-row' + (item.data[0] === '1' ? ' res-row-first' : '');
      for (let c = 0; c < headers.length; c++) {
        const td = document.createElement('td');
        td.className = `res-cell res-cell-${c}`;
        td.textContent = formatTime(item.data[c] || '');
        tr.appendChild(td);
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  div.appendChild(table);
  return div;
}

function renderResults(data) {
  document.getElementById('resTitle').textContent    = data.title    || '';
  document.getElementById('resSubtitle').textContent = data.subtitle || '';
  document.getElementById('resStatus').textContent   = data.status   || '';

  const headers = data.headers || [];

  // Flatten categories into a single item list
  const items = [];
  for (const cat of (data.categories || [])) {
    items.push({ type: 'category', name: cat.name });
    for (const row of cat.rows) items.push({ type: 'row', data: row });
  }

  const pages = splitPages(items);
  carouselPageCount = pages.length;
  carouselPage = 0;

  // Size carousel to the tallest page so the overlay shrinks to fit
  const tallestH = Math.max(...pages.map(page =>
    COL_H + page.reduce((h, item) => h + (item.type === 'category' ? CAT_H : ROW_H), 0)
  ));
  const carousel = document.getElementById('resultsCarousel');
  carousel.style.height = tallestH + 'px';
  carousel.innerHTML = '';
  for (let i = 0; i < pages.length; i++) {
    const p = buildPage(pages[i], headers);
    if (i > 0) p.style.display = 'none';
    carousel.appendChild(p);
  }

  updatePageIndicator();

  if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
  if (pages.length > 1) {
    carouselTimer = setInterval(advanceCarousel, 7000);
  }
}

function advanceCarousel() {
  const pages = document.querySelectorAll('.res-page');
  if (!pages.length) return;
  pages[carouselPage].style.display = 'none';
  carouselPage = (carouselPage + 1) % carouselPageCount;
  pages[carouselPage].style.display = 'flex';
  updatePageIndicator();
}

function updatePageIndicator() {
  const el = document.getElementById('resPageInfo');
  el.textContent = carouselPageCount > 1
    ? `${carouselPage + 1} / ${carouselPageCount}` : '';
}

// ── Firebase configuration ────────────────────────────────────────────────────
// Set FIREBASE_DB_URL to your Realtime Database URL before deploying to GitHub Pages.
// Example: 'https://my-project-default-rtdb.firebaseio.com'
const FIREBASE_DB_URL = 'https://alpine-overlay-default-rtdb.europe-west1.firebasedatabase.app/';

// ── Handle incoming overlay data ──────────────────────────────────────────────
function handleData(data) {
  if (!data) return;

  // ── Chroma key / test background ──────────────────────
  document.body.style.background = data.showChroma ? (data.chromaColor || '#FF00FF') : '';
  document.body.classList.toggle('chroma-mode', !!data.showChroma);

  const bg = document.getElementById('testBg');
  if (data.showBackground) {
    bg.style.display = 'block';
    applyData(TEST);
  } else {
    bg.style.display = 'none';
    applyData(data);
  }

  // ── Results overlay ───────────────────────────────────
  const rv      = data.resultsVersion ?? null;
  const overlay = document.getElementById('resultsOverlay');
  const timing  = document.querySelector('.timing-overlay');
  const showRes = rv !== null;

  if (rv !== lastResultsVersion) {
    lastResultsVersion = rv;
    if (showRes) {
      // Fetch results data from Firebase (one-time GET, only when version changes)
      fetch(`${FIREBASE_DB_URL}/overlay/results.json`)
        .then(r => r.json())
        .then(renderResults);
    } else {
      if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
      document.getElementById('resultsCarousel').innerHTML = '';
    }
  }

  overlay.style.display = showRes ? 'flex' : 'none';
  timing.style.display  = showRes ? 'none' : '';

  // ── Sponsors & watermark ──────────────────────────────
  const vis = data.showSponsors ? '' : 'none';
  document.querySelector('.sponsor-bar').style.display = vis;
  document.querySelector('.watermark').style.display   = vis;
}

// ── Firebase Realtime Database — REST EventSource ─────────────────────────────
// Firebase sends 'put' on initial connect (full data) and on any full replacement.
// It sends 'patch' for partial updates (e.g. individual field changes).
let _cache = {};

const _es = new EventSource(`${FIREBASE_DB_URL}/overlay.json`);

_es.addEventListener('put', function(e) {
  const msg = JSON.parse(e.data);
  if (msg.path === '/') {
    _cache = msg.data || {};
  } else {
    // Nested path — set the specific field
    const keys = msg.path.replace(/^\//, '').split('/');
    let node = _cache;
    for (let i = 0; i < keys.length - 1; i++) {
      node[keys[i]] = node[keys[i]] || {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = msg.data;
  }
  handleData(_cache);
});

_es.addEventListener('patch', function(e) {
  const msg = JSON.parse(e.data);
  if (msg.path === '/') {
    Object.assign(_cache, msg.data || {});
  }
  handleData(_cache);
});
