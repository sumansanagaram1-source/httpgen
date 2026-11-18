const BASE = 'https://httpbin.org/status/';
const LOOP_COUNT = 5;
const LOOP_GAP_SEC = 60;
const LOOP_SLEEP_SEC = 300;

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const btn200 = document.getElementById('btn200');
const btn500 = document.getElementById('btn500');
const btnLoop = document.getElementById('btnLoop');
const btnClear = document.getElementById('btnClear');

let seq = 0;
let loopController = null; // AbortController while the loop is running

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
  }
}

// ---------- wiring ----------

btn200.addEventListener('click', () => sendRequest(200));
btn500.addEventListener('click', () => sendRequest(500));
btnLoop.addEventListener('click', () => {
  if (loopController) loopController.abort();
  else runLoop();
});
btnClear.addEventListener('click', () => { logEl.innerHTML = ''; seq = 0; });
