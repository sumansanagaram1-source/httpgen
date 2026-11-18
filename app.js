const BASE = 'https://httpbin.org/status/';
const LOOP_COUNT = 5;
const LOOP_GAP_SEC = 60;
const LOOP_SLEEP_SEC = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PHASE_MS = 3 * DAY_MS;   // 3 days of 200s, then 3 days of 500s
const DAYS_GAP_MS = 60 * 1000;      // 60 s between requests
const MAX_LOG_ENTRIES = 200;        // keep the page light during multi-day runs

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const btn200 = document.getElementById('btn200');
const btn500 = document.getElementById('btn500');
const btnLoop = document.getElementById('btnLoop');
const btnLoopDays = document.getElementById('btnLoopDays');
const btnClear = document.getElementById('btnClear');

let seq = 0;
let loopController = null;     // AbortController while "loop" is running
let loopDaysController = null; // AbortController while "loop days" is running

// ---------- rendering ----------

function createEntry(label) {
  const el = document.createElement('div');
  el.className = 'entry';
  el.innerHTML = `
    <div class="entry-head">
      <span>#${++seq} · ${label} <span class="badge pending">pending</span></span>
      <span class="time">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="panes">
      <div class="pane"><h3>Request</h3><pre class="req"></pre></div>
      <div class="pane"><h3>Response</h3><pre class="res">waiting…</pre></div>
    </div>`;
  logEl.prepend(el);
  while (logEl.children.length > MAX_LOG_ENTRIES) logEl.lastElementChild.remove();
  return el;
}

function setBadge(entry, text, cls) {
  const b = entry.querySelector('.badge');
  b.textContent = text;
  b.className = `badge ${cls}`;
}

function formatHeaders(headers) {
  const lines = [];
  headers.forEach((v, k) => lines.push(`${k}: ${v}`));
  return lines.length ? lines.join('\n') : '(none)';
}

function setStatus(text) {
  statusEl.textContent = text;
}

// ---------- HTTP ----------

async function sendRequest(code, label = `GET /status/${code}`) {
  const url = BASE + code;
  const request = new Request(url, {
    method: 'GET',
    headers: { Accept: 'application/json, text/plain, */*' },
    cache: 'no-store',
  });

  const entry = createEntry(label);
  entry.querySelector('.req').textContent =
    `${request.method} ${request.url}\n` +
    `mode: ${request.mode}\n` +
    `cache: ${request.cache}\n\n` +
    `Headers:\n${formatHeaders(request.headers)}`;

  const start = performance.now();
  try {
    const response = await fetch(request);
    const body = await response.text();
    const ms = Math.round(performance.now() - start);

    setBadge(entry, `${response.status}`, `s${String(response.status)[0]}`);
    entry.querySelector('.res').textContent =
      `HTTP ${response.status} ${response.statusText}\n` +
      `ok: ${response.ok}\n` +
      `url: ${response.url}\n` +
      `time: ${ms} ms\n\n` +
      `Headers:\n${formatHeaders(response.headers)}\n\n` +
      `Body:\n${body || '(empty)'}`;
    return response;
  } catch (err) {
    setBadge(entry, 'error', 'fail');
    entry.querySelector('.res').textContent = `Network error: ${err.message}`;
    return null;
  }
}

// ---------- loop ----------

// Waits `sec` seconds, updating the status line each second. Rejects on abort.
function countdown(sec, message, signal) {
  return new Promise((resolve, reject) => {
    let remaining = sec;
    const tick = () => setStatus(`${message} — ${remaining}s remaining`);
    tick();
    const id = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(id); resolve(); } else tick();
    }, 1000);
    signal.addEventListener('abort', () => {
      clearInterval(id);
      reject(new DOMException('Loop stopped', 'AbortError'));
    }, { once: true });
  });
}

async function runPhase(code, signal, phaseName) {
  for (let i = 1; i <= LOOP_COUNT; i++) {
    if (signal.aborted) throw new DOMException('Loop stopped', 'AbortError');
    setStatus(`${phaseName}: sending request ${i}/${LOOP_COUNT} to /status/${code}`);
    await sendRequest(code, `loop · ${phaseName} ${i}/${LOOP_COUNT} · GET /status/${code}`);
    if (i < LOOP_COUNT) {
      await countdown(LOOP_GAP_SEC, `${phaseName}: next request (${i + 1}/${LOOP_COUNT}) in`, signal);
    }
  }
}

async function runLoop() {
  loopController = new AbortController();
  const { signal } = loopController;
  btnLoop.textContent = 'stop loop';
  btnLoop.classList.add('running');
  btnLoopDays.disabled = true;

  try {
    await runPhase(200, signal, 'Phase 1');
    await countdown(LOOP_SLEEP_SEC, 'Sleeping before Phase 2 (/status/500)', signal);
    await runPhase(500, signal, 'Phase 2');
    setStatus('Loop complete: 5 × 200 and 5 × 500 sent.');
  } catch (err) {
    if (err.name === 'AbortError') setStatus('Loop stopped by user.');
    else setStatus(`Loop error: ${err.message}`);
  } finally {
    loopController = null;
    btnLoop.textContent = 'loop';
    btnLoop.classList.remove('running');
    btnLoopDays.disabled = false;
  }
}

// ---------- loop days ----------

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (d ? `${d}d ` : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Waits until the wall-clock time `targetMs`, refreshing the status each second.
// Uses Date.now() rather than counting ticks, so background-tab timer
// throttling can delay a request but never shifts the 3-day schedule.
function waitUntil(targetMs, render, signal) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() >= targetMs) { clearInterval(id); resolve(); } else render();
    };
    const id = setInterval(tick, 1000);
    tick();
    signal.addEventListener('abort', () => {
      clearInterval(id);
      reject(new DOMException('Loop stopped', 'AbortError'));
    }, { once: true });
  });
}

// Asks the browser to keep the screen awake so the computer doesn't sleep
// mid-run. Not supported everywhere; released automatically if the tab is hidden.
async function acquireWakeLock(signal) {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  const request = async () => {
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && !signal.aborted) request(); };
  await request();
  document.addEventListener('visibilitychange', onVisible);
  signal.addEventListener('abort', () => {
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
  }, { once: true });
}

// The run's start time and counters are saved in localStorage so a reload
// (or reopening the page) resumes the same 6-day schedule instead of
// starting over. Storage can be unavailable (private mode, blocked site
// data), so every access is guarded and the loop still runs without it.
const DAYS_STORAGE_KEY = 'httpgen.loopDays';

function loadDaysState() {
  try {
    const s = JSON.parse(localStorage.getItem(DAYS_STORAGE_KEY));
    if (s && typeof s.start === 'number' && s.counts) return s;
  } catch { /* ignore */ }
  return null;
}
function saveDaysState(state) {
  try { localStorage.setItem(DAYS_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
function clearDaysState() {
  try { localStorage.removeItem(DAYS_STORAGE_KEY); } catch { /* ignore */ }
}

// Only one tab may run the loop: a second tab of the same page would
// otherwise resume the saved run too and double the requests.
function runLoopDays(resume = null) {
  if (!navigator.locks) return loopDaysBody(resume);
  return navigator.locks.request('httpgen-loop-days', { ifAvailable: true }, (lock) =>
    lock ? loopDaysBody(resume)
         : setStatus('Loop days is already running in another tab of this page.'));
}

async function loopDaysBody(resume) {
  loopDaysController = new AbortController();
  const { signal } = loopDaysController;
  btnLoopDays.textContent = 'stop loop days';
  btnLoopDays.classList.add('running');
  btnLoop.disabled = true;
  acquireWakeLock(signal);

  const state = resume ?? { start: Date.now(), counts: { 200: 0, 500: 0, failed: 0 } };
  saveDaysState(state);
  const { start, counts } = state;
  const switchAt = start + DAYS_PHASE_MS;
  const endAt = start + 2 * DAYS_PHASE_MS;

  const summary = () =>
    `sent: ${counts[200]} × 200, ${counts[500]} × 500` +
    (counts.failed ? `, ${counts.failed} network errors` : '');

  // Requests go out on a fixed grid: start, start + 60 s, start + 120 s, …
  // A fresh run sends at once; a resumed run waits for the next grid slot, so
  // a reload right after a request doesn't send a duplicate. Slots missed
  // while the page was closed or the computer slept are skipped, not replayed.
  const nextSlot = () => Math.floor((Date.now() - start) / DAYS_GAP_MS) + 1;
  let slot = resume ? Math.ceil((Date.now() - start) / DAYS_GAP_MS) : 0;

  try {
    if (resume) {
      const r = new Date(start).toLocaleString();
      setStatus(`Loop days resumed (started ${r}) — ${summary()}`);
    }
    while (true) {
      const slotAt = start + slot * DAYS_GAP_MS;
      if (slotAt >= endAt) break;

      await waitUntil(slotAt, () => {
        const t = Date.now();
        const phase = t < switchAt ? 'Phase 1 (200)' : 'Phase 2 (500)';
        const nextPhaseNote = t < switchAt
          ? `switch to 500 in ${fmtDuration(switchAt - t)}`
          : `finishes in ${fmtDuration(endAt - t)}`;
        setStatus(`Loop days — ${phase} · next request in ${fmtDuration(slotAt - t)} · ${nextPhaseNote} · ${summary()}`);
      }, signal);

      const code = slotAt < switchAt ? 200 : 500;
      const day = Math.floor((slotAt - start) / DAY_MS) + 1;
      const res = await sendRequest(code, `loop days · day ${day} · GET /status/${code}`);
      if (signal.aborted) throw new DOMException('Loop stopped', 'AbortError');
      counts[code]++;
      if (!res) counts.failed++;
      saveDaysState(state);

      slot = nextSlot();
    }
    clearDaysState();
    setStatus(`Loop days complete — ${summary()}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      clearDaysState();
      setStatus(`Loop days stopped by user — ${summary()}`);
    } else {
      setStatus(`Loop days error: ${err.message}`);
    }
  } finally {
    if (!signal.aborted) loopDaysController.abort(); // releases the wake lock
    loopDaysController = null;
    btnLoopDays.textContent = 'loop days';
    btnLoopDays.classList.remove('running');
    btnLoop.disabled = false;
  }
}

// ---------- wiring ----------

btn200.addEventListener('click', () => sendRequest(200));
btn500.addEventListener('click', () => sendRequest(500));
btnLoop.addEventListener('click', () => {
  if (loopController) loopController.abort();
  else runLoop();
});
btnLoopDays.addEventListener('click', () => {
  if (loopDaysController) loopDaysController.abort();
  else runLoopDays();
});
btnClear.addEventListener('click', () => { logEl.innerHTML = ''; seq = 0; });

// Resume an unfinished "loop days" run left over from before a reload.
{
  const saved = loadDaysState();
  if (saved) {
    if (Date.now() < saved.start + 2 * DAYS_PHASE_MS) runLoopDays(saved);
    else clearDaysState(); // it would have finished while the page was closed
  }
}
