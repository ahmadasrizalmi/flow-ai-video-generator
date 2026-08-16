/**
 * FLOW AI VIDEO GENERATOR - Panel (Orkestrator)
 * ----------------------------------------------------------------
 * Alur: isi API key → pilih preset → deskripsi subjek → upload image
 * (opsional) → Generate (DeepSeek via bg) → preview shot → Mulai Batch:
 *   inject image reference (sekali) → per shot: set prompt trusted →
 *   Enter → tunggu agent idle → tunggu tile video baru → download.
 *
 * Semua aksi "trusted" lewat chrome.debugger (CDP) di background —
 * React Flow menolak event sintetik (pola terbukti extension lama).
 */

'use strict';

const S = {
  tabId: null,
  debuggerAttached: false,
  running: false,
  stopRequested: false,
  shots: [],
  processed: 0,
  failed: 0,
  knownVideoUuids: new Set(),
  image: null, // { b64, mime, filename }
  customPresets: []
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString('id-ID', { hour12: false });

function log(msg, cls = '') {
  const el = $('log');
  const line = document.createElement('div');
  line.innerHTML = `<span class="t">[${now()}]</span> <span class="${cls}">${escapeHtml(msg)}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setBadge(state) {
  const b = $('connBadge');
  const map = {
    idle: ['badge-idle', '● idle'],
    ok: ['badge-ok', '● siap'],
    run: ['badge-run', '● running'],
    err: ['badge-err', '● error']
  };
  const [cls, txt] = map[state] || map.idle;
  b.className = 'badge ' + cls;
  b.textContent = txt;
}

// ============ messaging ============
function sendToBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      resolve(resp || { ok: false, error: 'no response' });
    });
  });
}
function sendToContent(msg) {
  if (S.tabId == null) return Promise.resolve({ ok: false, error: 'no tab' });
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(S.tabId, msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      resolve(resp || { ok: false, error: 'no response' });
    });
  });
}

// ============ debugger / CDP ============
async function injectContentIfNeeded() {
  const ping = await sendToContent({ type: 'FLOW_PING' });
  if (ping.ok) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content/content.js'] });
    await sleep(300);
    return true;
  } catch (e) {
    log('Gagal inject content script: ' + e.message, 'err');
    return false;
  }
}

async function ensureDebugger() {
  if (S.debuggerAttached) return true;
  const r = await sendToBg({ type: 'BG_ATTACH', tabId: S.tabId });
  if (r.ok) {
    S.debuggerAttached = true;
    log('Debugger terpasang (CDP). Jika ada infobar, klik OK sekali.', 'ok');
    return true;
  }
  log('Gagal attach debugger: ' + (r.error || ''), 'err');
  return false;
}

async function cdp(method, params) {
  const r = await sendToBg({ type: 'BG_CDP', method, params });
  return r.ok ? (r.result || {}) : r;
}
async function cdpType(text) { return sendToBg({ type: 'BG_TYPE_TEXT', text }); }
async function cdpEnter() { return sendToBg({ type: 'BG_PRESS_ENTER' }); }
async function cdpClick(x, y) { return sendToBg({ type: 'BG_CLICK', x, y }); }

async function getFlowState() {
  const r = await sendToContent({ type: 'FLOW_GET_STATE' });
  return r.ok ? r.state : null;
}

// ============ flow actions ============
async function closeDetailIfOpen() {
  const st = await getFlowState();
  if (st && st.hasDetailView) {
    await sendToContent({ type: 'FLOW_CLOSE_DETAIL' });
    await sleep(1200);
  }
}

/** Set prompt via CDP trusted (Ctrl+A → Backspace → insertText). */
async function setPromptTrusted(text) {
  await sendToContent({ type: 'FLOW_SUBMIT_PREP' }); // fokus box
  await sleep(400);
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await sleep(300);
  const r = await cdpType(text);
  if (!r.ok) {
    const fr = await sendToContent({ type: 'FLOW_SET_PROMPT', text });
    return fr.ok;
  }
  await sleep(500);
  const st = await getFlowState();
  return st ? st.promptText.includes(text.slice(0, 20)) : false;
}

async function submitTrusted() {
  const r = await cdpEnter();
  if (!r.ok) return false;
  await sleep(2500);
  let st = await getFlowState();
  if (st && (st.generating || st.promptText === '')) return true;
  // fallback: klik tombol submit via CDP
  const c = await sendToContent({ type: 'FLOW_GET_COORDS', desc: { submitBtn: true } });
  if (c.ok && c.coords) {
    await cdpClick(c.coords.x, c.coords.y);
    await sleep(2500);
    st = await getFlowState();
    if (st && (st.generating || st.promptText === '')) return true;
  }
  return false;
}

async function waitAgentIdle(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (S.stopRequested) throw new Error('Dihentikan user');
    const st = await getFlowState();
    if (st && !st.generating && st.hasSubmit) return true;
    await sleep(2500);
  }
  return false;
}

/** Tunggu canvas benar-benar idle (agent idle + tak ada tile ber-progress). */
async function waitForCanvasIdle(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (S.stopRequested) throw new Error('Dihentikan user');
    const st = await getFlowState();
    if (st) {
      const busy = st.generating || (st.generatingTiles || []).length > 0;
      if (!busy) return true;
    }
    await sleep(3000);
  }
  return false;
}

/** Tunggu tile video baru (uuid belum dikenal). */
async function waitNewVideoTile(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (S.stopRequested) throw new Error('Dihentikan user');
    const st = await getFlowState();
    if (st) {
      for (const t of st.videoTiles || []) {
        if (t.isVideo && t.visible && !S.knownVideoUuids.has(t.uuid)) return t;
      }
      const failed = (st.generatingTiles || []).filter((x) => x.stage === 'failed');
      if (failed.length > 0 && Date.now() - start > 120000) {
        return { failed: true, detail: failed[0] };
      }
    }
    await sleep(3000);
  }
  return null;
}

// ============ download ============
function makeSafeName(s) {
  return String(s || 'video')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'video';
}

async function waitDownloadDone(downloadId, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (S.stopRequested) throw new Error('Dihentikan user');
    const items = await chrome.downloads.search({ id: downloadId });
    if (items.length) {
      const st = items[0].state;
      if (st === 'complete') return { ok: true, filename: items[0].filename };
      if (st === 'interrupted') return { ok: false, error: 'interrupted: ' + (items[0].error || '') };
    }
    await sleep(2000);
  }
  return { ok: false, error: 'timeout menunggu download' };
}

/** Download langsung via URL getMediaUrlRedirect (cookie Flow otomatis). */
async function downloadDirect(tile, safeName) {
  const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${tile.uuid}`;
  log('  ↓ Download: ' + safeName + '.mp4', 's');
  const r = await sendToBg({ type: 'BG_DOWNLOAD', url, filename: safeName + '.mp4' });
  if (!r.ok) return { ok: false, error: r.error || 'download gagal' };
  const res = await waitDownloadDone(r.downloadId, 180000);
  return res.ok ? { ok: true, filename: res.filename } : res;
}

// ============ init ============
async function init() {
  const sel = $('presetSelect');
  (window.PRESETS || []).forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    sel.appendChild(o);
  });
  const r = await sendToBg({ type: 'PR_GET_CUSTOM' });
  if (r.ok) {
    S.customPresets = r.customPresets || [];
    S.customPresets.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label + ' (custom)';
      sel.appendChild(o);
    });
  }
  const k = await sendToBg({ type: 'DS_GET_KEY' });
  if (k.ok && k.key) { $('apiKey').value = k.key; $('keyStatus').textContent = '✓ tersimpan'; }
  attachEvents();
}
function attachEvents() {
  $('apiKey').addEventListener('change', async (e) => {
    const r = await sendToBg({ type: 'DS_SET_KEY', key: e.target.value });
    $('keyStatus').textContent = r.ok ? '✓ tersimpan' : 'gagal simpan';
  });
  $('btnGenerate').addEventListener('click', onGenerate);
  $('btnBatch').addEventListener('click', onBatch);
  $('btnStop').addEventListener('click', () => {
    S.stopRequested = true;
    log('⏹ Stop diminta… (menunggu langkah selesai)', 'warn');
  });
  $('imageFile').addEventListener('change', onImagePicked);
}

// ============ image upload (panel) ============
function onImagePicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const b64 = String(reader.result).split(',')[1] || '';
    S.image = { b64, mime: file.type || 'image/png', filename: file.name };
    const prev = $('imagePreview');
    prev.src = reader.result;
    prev.classList.remove('hidden');
    await sendToBg({ type: 'BATCH_SET_IMAGE', img: S.image });
    log('Image reference siap: ' + file.name + ' (' + Math.round(b64.length * 0.75 / 1024) + ' KB)', 'ok');
  };
  reader.readAsDataURL(file);
}

// ============ Generate (DeepSeek) ============
async function onGenerate() {
  const presetId = $('presetSelect').value;
  const syari = $('syariToggle').checked;
  const subjectDesc = $('subjectDesc').value.trim();
  const shots = parseInt($('shotCount').value, 10) || 8;
  const duration = parseInt($('shotDuration').value, 10) || 10;

  if (!subjectDesc) return log('Isi deskripsi subjek/produk dulu.', 'err');
  setBadge('run'); log('Generate prompt via DeepSeek…');
  $('btnGenerate').disabled = true;

  const system = window.buildSystemPrompt({ presetId, syari });
  const user = window.buildUserPrompt({ subjectDesc, shots, duration });

  const r = await sendToBg({ type: 'DS_GENERATE', system, user, maxTokens: 4000 });
  $('btnGenerate').disabled = false;

  if (!r.ok) { setBadge('err'); return log('Gagal generate: ' + (r.error || '?'), 'err'); }
  S.shots = r.shots || [];
  renderShots();
  setBadge('ok');
  log('Selesai: ' + S.shots.length + ' shot.');
}

function renderShots() {
  const card = $('shotsCard');
  const list = $('shotList');
  card.hidden = false;
  $('shotCountInfo').textContent = S.shots.length + ' shot';
  list.innerHTML = '';
  S.shots.forEach((s, i) => {
    const d = document.createElement('details');
    d.innerHTML = `
      <summary>${i + 1}. ${escapeHtml(s.ts || '')} — ${escapeHtml((s.narasi || '').slice(0, 60))}</summary>
      <div class="shot-body">
        <p><b>Narasi:</b> ${escapeHtml(s.narasi || '')}</p>
        <p><b>Visual:</b> ${escapeHtml(s.visual || '')}</p>
        <p><b>Kamera:</b> ${escapeHtml(s.kamera || '')} · <b>Speed:</b> ${escapeHtml(s.speed || '')} · <b>Efek:</b> ${escapeHtml(s.effect || '')}</p>
        <p class="flow-prompt"><b>prompt_flow:</b> ${escapeHtml(s.prompt_flow || '')}</p>
      </div>`;
    list.appendChild(d);
  });
}

// ============ Batch ============
async function onBatch() {
  if (S.running) return;
  if (!S.shots.length) return log('Generate dulu sebelum batch.', 'err');

  // 1. tab Flow aktif
  const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*'] });
  const flowTab = tabs.find((t) => t.active) || tabs[0];
  if (!flowTab) return log('Buka tab Google Flow dulu (labs.google/fx).', 'err');
  S.tabId = flowTab.id;

  // 2. siapkan content + debugger
  if (!await injectContentIfNeeded()) return;
  if (!await ensureDebugger()) return;

  // 3. dismiss modal & verifikasi editor
  await sendToContent({ type: 'FLOW_DISMISS_MODALS' });
  await sleep(1500);
  const st0 = await getFlowState();
  if (!st0 || !st0.hasEditor) {
    setBadge('err');
    return log('Editor Flow tidak ditemukan. Pastikan project Flow sudah dibuka.', 'err');
  }
  (st0.videoTiles || []).forEach((t) => S.knownVideoUuids.add(t.uuid));
  await closeDetailIfOpen();

  // 4. inject image reference (sekali di awal batch)
  if (S.image) {
    log('Inject image reference…');
    const inj = await sendToBg({ type: 'INJ_IMAGE', img: S.image });
    log(inj.ok ? '  ✓ Image terpasang (' + inj.path + ')' : '  ! Image gagal: ' + inj.error, inj.ok ? 'ok' : 'err');
    await sleep(1500);
  }

  // 5. jalankan shot
  S.running = true; S.stopRequested = false; S.processed = 0; S.failed = 0;
  setBadge('run');
  $('btnBatch').disabled = true;
  $('btnStop').disabled = false;
  log('Memulai batch: ' + S.shots.length + ' video. Panel boleh tetap terbuka.', 'ok');

  for (let i = 0; i < S.shots.length; i++) {
    if (S.stopRequested) break;
    log(`\n——— [${i + 1}/${S.shots.length}] ———`, 's');
    let ok = false;
    const attempts = 3;
    for (let a = 0; a < attempts && !ok && !S.stopRequested; a++) {
      if (a > 0) {
        log(`  ↻ Percobaan ulang #${a + 1}…`, 'warn');
        await sleep(10000);
        await closeDetailIfOpen();
      }
      try {
        ok = await runOneShot(S.shots[i]);
      } catch (e) {
        log('  ✗ Error: ' + e.message, 'err');
        if (e.message.includes('Dihentikan')) break;
      }
    }
    if (ok) S.processed++; else S.failed++;
    $('shotCountInfo').textContent = `Selesai ${S.processed}/${S.shots.length} · gagal ${S.failed}`;
  }

  S.running = false;
  $('btnBatch').disabled = false;
  $('btnStop').disabled = true;
  setBadge('ok');
  if (S.stopRequested) log('⏹ Batch dihentikan oleh user.', 'warn');
  log(`Batch selesai: ${S.processed} sukses, ${S.failed} gagal.`, 's');
  await sendToBg({ type: 'BG_DETACH' });
  S.debuggerAttached = false;
}

/** Satu shot: set prompt → submit → tunggu selesai → download. */
async function runOneShot(shot) {
  const promptText = String(shot.prompt_flow || '').trim();
  if (!promptText) { log('  ✗ Shot tanpa prompt_flow — lewati.', 'err'); return false; }
  log('▸ ' + promptText.slice(0, 90) + (promptText.length > 90 ? '…' : ''), 's');

  // 0. detail view tutup & canvas idle
  await closeDetailIfOpen();
  const idleOk = await waitForCanvasIdle(600000);
  if (!idleOk) { log('  ✗ Canvas masih sibuk — lewati.', 'err'); return false; }

  // 1. snapshot tile lama → hanya tile BARU milik shot ini
  const before = await getFlowState();
  ((before && before.videoTiles) || []).forEach((t) => S.knownVideoUuids.add(t.uuid));

  // 2. set prompt trusted
  const okSet = await setPromptTrusted(promptText);
  if (!okSet) { log('  ✗ Gagal menulis prompt di kolom.', 'err'); return false; }

  // 3. submit
  const okSub = await submitTrusted();
  if (!okSub) { log('  ✗ Gagal submit (Enter/tombol tidak merespons).', 'err'); return false; }
  log('  ✓ Prompt terkirim — menunggu agent…', 'ok');

  // 4. tunggu agent idle
  const agentOk = await waitAgentIdle(180000);
  if (!agentOk) { log('  ✗ Agent tidak kunjung idle (timeout).', 'err'); return false; }
  log('  ✓ Agent selesai — menunggu video…', 'ok');

  // 5. tunggu tile video baru
  const tile = await waitNewVideoTile(900000);
  if (!tile) { log('  ✗ Tidak ada tile video baru (timeout). Cek manual di Flow.', 'err'); return false; }
  if (tile.failed) { log('  ✗ Video gagal: ' + (tile.detail ? tile.detail.text : '') + ' — retry.', 'err'); return false; }
  S.knownVideoUuids.add(tile.uuid);
  log('  ✓ Video jadi (uuid ' + tile.uuid.slice(0, 8) + ')', 'ok');

  // 6. download
  const safeName = 'shot_' + String(shot.n || '').padStart(2, '0') + '_' + makeSafeName(shot.narasi || '');
  const dl = await downloadDirect(tile, safeName);
  if (!dl.ok) { log('  ✗ Download gagal: ' + (dl.error || '?'), 'err'); return false; }
  log('  ✓ Downloaded: ' + (dl.filename || '').split('/').pop(), 'ok');
  return true;
}

// ============ boot ============
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
setBadge('idle');
log('Siap. Isi API key, Generate, lalu Mulai Batch di tab Flow.', 's');
init();
