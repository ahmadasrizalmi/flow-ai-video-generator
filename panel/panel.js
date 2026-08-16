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

/** Bersihkan isi prompt box (Ctrl+A + Backspace) — HANYA bila belum ada gambar. */
async function clearPromptBox() {
  await sendToContent({ type: 'FLOW_SUBMIT_PREP' }); // fokus box
  await sleep(300);
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await sleep(300);
}

/** Set prompt via CDP trusted (Ctrl+A → Backspace → insertText). */
async function setPromptTrusted(text) {
  await clearPromptBox();
  const r = await cdpType(text);
  if (!r.ok) {
    const fr = await sendToContent({ type: 'FLOW_SET_PROMPT', text });
    return fr.ok;
  }
  await sleep(500);
  const st = await getFlowState();
  const entered = st ? st.promptText : '';
  if (entered) log('  i Teks di kolom Flow: ' + entered.slice(0, 110) + (entered.length > 110 ? '…' : ''), 's');
  return entered.includes(text.slice(0, 20));
}

/**
 * Set prompt BERSAMA image reference: paste gambar ke prompt box →
 * verifikasi thumbnail muncul → kursor ke akhir (setelah gambar) → ketik
 * prompt. Gambar TIDAK dihapus (tidak pakai Ctrl+A/Backspace setelah paste).
 */
async function setPromptWithImage(text) {
  // 1. box harus kosong dulu (gambar belum ada di box → aman dihapus)
  const st0 = await getFlowState();
  if (st0 && st0.promptText) {
    await clearPromptBox();
    await sleep(400);
  }
  // 2. paste image + VERIFIKASI KERAS
  const inj = await sendToBg({ type: 'INJ_IMAGE', img: S.image });
  if (!inj.ok) {
    log('  ✗ Image reference GAGAL di-attach ke prompt: ' + (inj.error || '?'), 'err');
    return { ok: false, reason: 'image' };
  }
  if (!inj.verified) {
    log('  ✗ Image ter-paste tapi THUMBNAIL TIDAK TERDETEKSI (' + inj.path + ') — referensi tidak dijamin.', 'err');
    log('  → Hentikan batch. Coba paste gambar manual di kolom prompt Flow utk verifikasi.', 'err');
    return { ok: false, reason: 'image-verify' };
  }
  log('  ✓ Image reference terpasang di prompt (' + inj.path + ', thumbnail muncul)', 'ok');
  await sleep(800);
  // 3. kursor ke akhir (setelah gambar) → ketik prompt (tidak menghapus gambar)
  await sendToContent({ type: 'FLOW_POSITION_CURSOR_END' });
  await sleep(200);
  const r = await cdpType(text);
  if (!r.ok) {
    const fr = await sendToContent({ type: 'FLOW_SET_PROMPT', text });
    if (!fr.ok) return { ok: false, reason: 'type' };
  }
  await sleep(500);
  const st = await getFlowState();
  const entered = st ? st.promptText : '';
  if (entered) log('  i Teks di kolom Flow: ' + entered.slice(0, 110) + (entered.length > 110 ? '…' : ''), 's');
  return { ok: entered.includes(text.slice(0, 20)) };
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

// ============ mode vertikal (crop 9:16) — opsi cadangan ============
// Catatan: rasio utama di-set lewat Setelan agen Flow (applyVideoRatio) dan
// BERLAKU (9:16 → vertikal). Crop di sini hanya opsi cadangan/garansi bila
// user memilih mode output 'crop'/'both', atau bila verifikasi rasio gagal.
function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'video/mp4' });
}

/** Crop video asli ke tengah 9:16 via canvas + MediaRecorder (WebM). */
async function cropToVerticalBlob(srcBlob) {
  const W = 720, H = 1280, FPS = 30, BPS = 8000000;
  const url = URL.createObjectURL(srcBlob);
  let rec = null;
  try {
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout memuat video')), 60000);
      v.onloadeddata = () => { clearTimeout(to); res(); };
      v.onerror = () => { clearTimeout(to); rej(new Error('video asli tidak bisa didecode')); };
    });
    if (!v.videoWidth || !v.videoHeight) throw new Error('video asli tanpa dimensi valid');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(FPS);
    const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('MediaRecorder WebM tidak didukung browser');
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BPS });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime.split(';')[0] })); });
    // center-crop cover: isi penuh tinggi, potong samping (16:9 → 9:16)
    const draw = () => {
      const sW = v.videoWidth, sH = v.videoHeight;
      if (!sW || !sH) return;
      const scale = Math.max(W / sW, H / sH);
      const sw = W / scale, sh = H / scale;
      ctx.drawImage(v, (sW - sw) / 2, (sH - sh) / 2, sw, sh, 0, 0, W, H);
    };
    draw();
    rec.start(500);
    await v.play();
    await new Promise((res) => {
      let raf = 0;
      const loop = () => { draw(); if (!v.ended) raf = requestAnimationFrame(loop); else res(); };
      v.onended = () => { cancelAnimationFrame(raf); res(); };
      loop();
    });
    await sleep(400);
    rec.stop();
    return await stopped;
  } catch (e) {
    if (rec && rec.state === 'recording') { try { rec.stop(); } catch (_) {} }
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mode vertikal: fetch video asli → crop tengah 9:16 → download WebM. */
async function tryDownloadVertical(tile, safeName) {
  const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${tile.uuid}`;
  log('  ↻ Ambil video asli (uuid ' + tile.uuid.slice(0, 8) + ') utk crop 9:16…', 's');
  const r = await sendToContent({ type: 'FLOW_FETCH_MEDIA', url });
  if (!r.ok) return { ok: false, error: r.error || 'fetch media gagal' };
  log('  ↻ Video asli ' + Math.round((r.size || 0) / 1048576) + ' MB — crop tengah 9:16…', 's');
  const srcBlob = b64ToBlob(r.data, r.mime || 'video/mp4');
  let vblob;
  try {
    vblob = await cropToVerticalBlob(srcBlob);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const filename = safeName + '_vertikal.webm';
  log('  ↻ Download vertikal: ' + filename + ' (' + Math.round(vblob.size / 1048576) + ' MB)…', 's');
  const dlUrl = URL.createObjectURL(vblob);
  try {
    const dl = await sendToBg({ type: 'BG_DOWNLOAD', url: dlUrl, filename });
    if (!dl.ok) return { ok: false, error: dl.error || 'download gagal' };
    const res = await waitDownloadDone(dl.downloadId, 180000);
    return res.ok ? { ok: true, filename: res.filename } : res;
  } finally {
    setTimeout(() => URL.revokeObjectURL(dlUrl), 60000);
  }
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
  $('btnCopyScript').addEventListener('click', copyScript);
  $('btnCheckSettings').addEventListener('click', onCheckSettings);
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
  const narration = $('narration').value.trim();
  const shots = parseInt($('shotCount').value, 10) || 8;
  const duration = parseInt($('shotDuration').value, 10) || 10;

  if (!subjectDesc && !narration) return log('Isi deskripsi subjek/produk (atau narasi) dulu.', 'err');
  if (narration) {
    const words = narration.split(/\s+/).length;
    if (words < shots * 3) {
      log('Hint: narasi pendek (' + words + ' kata) utk ' + shots + ' shot — DeepSeek akan pakai teks ini sebagai pembuka lalu melanjutkan ceritanya sendiri.', 'warn');
    }
  }
  setBadge('run'); log('Generate prompt via DeepSeek…');
  $('btnGenerate').disabled = true;

  const preset = (window.PRESETS || []).find((p) => p.id === presetId);
  const system = window.buildSystemPrompt({ presetId, syari });
  const user = window.buildUserPrompt({ title: preset ? preset.label : '', subjectDesc, narration, shots, duration });

  const r = await sendToBg({ type: 'DS_GENERATE', system, user, maxTokens: 4000 });
  $('btnGenerate').disabled = false;

  if (!r.ok) { setBadge('err'); return log('Gagal generate: ' + (r.error || '?'), 'err'); }
  // urutkan berdasarkan n — DeepSeek bisa mengembalikan array tak berurutan,
  // dan batch HARUS mengirim sesuai urutan cerita (scene 1, 2, 3, ...)
  S.shots = (r.shots || []).sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0));
  renderShots();
  setBadge('ok');
  log('Selesai: ' + S.shots.length + ' shot berkesinambungan.');
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
/**
 * Terapkan rasio video di Setelan agen Flow (via CDP trusted click).
 * Rasio di Setelan agen MEMANG BERLAKU di Flow (9:16 → vertikal) —
 * kunci keberhasilannya: buka Setelan → klik chip rasio → Simpan,
 * semuanya terkonfirmasi, bukan best-effort diam-diam.
 */
async function applyVideoRatio(ratio) {
  if (!ratio) return true;
  log('Terapkan rasio video ' + ratio + ' di Setelan agen…', 's');

  // 0. diagnosa dulu: apa yang terdeteksi di UI Flow
  const diag = await sendToContent({ type: 'FLOW_SETTINGS_STATE' });
  if (diag.ok) {
    log('  i Diagnosa: tombol Setelan=' + (diag.settingsBtn ? 'ada' : 'TIDAK ADA') +
        ', section video=' + (diag.hasVideoSection ? 'ada' : 'TIDAK ADA') +
        ', rasio aktif=' + (diag.activeRatio || 'tidak terdeteksi') +
        ', opsi rasio=' + (diag.ratioButtons || []).length + ' ditemukan', 's');
  }

  // 1. buka Setelan via CDP trusted (klik sintetik sering ditolak Flow)
  const sc = await sendToContent({ type: 'FLOW_GET_SETTINGS_COORDS' });
  if (sc.ok && sc.coords) {
    await cdpClick(sc.coords.x, sc.coords.y);
  } else {
    const open = await sendToContent({ type: 'FLOW_OPEN_SETTINGS' });
    if (!open.ok) {
      log('  ! Tidak bisa membuka Setelan — set rasio MANUAL di Flow (ikon Setelan → Default pembuatan video).', 'warn');
      return true;
    }
  }
  await sleep(2500);

  // 2. cek rasio aktif; kalau sudah sesuai, langsung ke Simpan
  const act = await sendToContent({ type: 'FLOW_GET_ACTIVE_RATIO' });
  let needClick = true;
  if (act.ok && act.ratio === ratio) {
    needClick = false;
    log('  ✓ Rasio sudah ' + ratio, 'ok');
  } else {
    const c = await sendToContent({ type: 'FLOW_GET_RATIO_COORDS', ratio });
    if (c.ok && c.coords) {
      await cdpClick(c.coords.x, c.coords.y);
      await sleep(1500);
      const act2 = await sendToContent({ type: 'FLOW_GET_ACTIVE_RATIO' });
      if (act2.ok && act2.ratio === ratio) log('  ✓ Rasio diset ke ' + ratio, 'ok');
      else {
        log('  ! Klik rasio tidak terkonfirmasi (aktif=' + ((act2.ok && act2.ratio) || '?') + '). Set manual di Flow.', 'warn');
        needClick = false;
      }
    } else {
      log('  ! Opsi rasio ' + ratio + ' tidak ditemukan di Setelan. Set manual di Flow.', 'warn');
      needClick = false;
    }
  }

  // 3. simpan setelan
  const sv = await sendToContent({ type: 'FLOW_GET_SAVE_COORDS' });
  if (sv.ok && sv.coords) {
    await cdpClick(sv.coords.x, sv.coords.y);
    await sleep(1500);
    log('  ✓ Setelan disimpan.', 'ok');
  } else {
    log('  ! Tombol Simpan tidak ditemukan — pastikan setelan tersimpan manual.', 'warn');
  }

  // 4. VERIFIKASI KERAS: pastikan rasio benar-benar aktif setelah simpan
  await sleep(1000);
  const fin = await sendToContent({ type: 'FLOW_GET_ACTIVE_RATIO' });
  if (fin.ok && fin.ratio === ratio) {
    log('  ✓ VERIFIKASI: rasio aktif = ' + ratio, 'ok');
    return true;
  }
  log('  ✗ VERIFIKASI GAGAL: rasio aktif = ' + ((fin.ok && fin.ratio) || 'tidak terdeteksi') + ' (diminta ' + ratio + ').', 'err');
  log('  → Set rasio MANUAL di Flow: Setelan agen → Default pembuatan video → ' + ratio + '.', 'err');
  return false;
}

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

  // 3b. terapkan rasio di Setelan agen (bila diaktifkan)
  if ($('optApplyRatio').checked) {
    await applyVideoRatio($('optRatio').value);
  }

  // 4. inject image TIDAK di sini — di-paste PER SHOT di runOneShot,
  //    supaya gambar selalu ikut terkirim bersama tiap prompt (dan tidak
  //    terhapus oleh Ctrl+A/Backspace).

  // 5. jalankan shot
  S.running = true; S.stopRequested = false; S.processed = 0; S.failed = 0;
  setBadge('run');
  $('btnBatch').disabled = true;
  $('btnStop').disabled = false;
  const modeLabel = $('optPromptMode').value === 'motion' ? 'ringkas motion-only' : 'deskriptif lengkap (visual+kamera+efek)';
  log('Memulai batch: ' + S.shots.length + ' video. Mode prompt: ' + modeLabel + '. Panel boleh tetap terbuka.', 'ok');

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
  const promptText = buildFlowPrompt(shot);
  if (!promptText) { log('  ✗ Shot tanpa prompt — lewati.', 'err'); return false; }
  log('▸ ' + promptText.slice(0, 90) + (promptText.length > 90 ? '…' : ''), 's');

  // 0. detail view tutup & canvas idle
  await closeDetailIfOpen();
  const idleOk = await waitForCanvasIdle(600000);
  if (!idleOk) { log('  ✗ Canvas masih sibuk — lewati.', 'err'); return false; }

  // 1. snapshot tile lama → hanya tile BARU milik shot ini
  const before = await getFlowState();
  ((before && before.videoTiles) || []).forEach((t) => S.knownVideoUuids.add(t.uuid));

  // 2. set prompt — dengan image reference (paste per shot, gambar ikut terkirim)
  const okSet = S.image ? await setPromptWithImage(promptText) : await setPromptTrusted(promptText);
  if (!okSet || !okSet.ok) {
    log('  ✗ Gagal menulis prompt di kolom' + (okSet && okSet.reason === 'image' ? ' (image reference)' : '') + '.', 'err');
    return false;
  }

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

  // 6. download sesuai mode output (crop / both / flow)
  const safeName = 'shot_' + String(shot.n || '').padStart(2, '0') + '_' + makeSafeName(shot.narasi || '');
  const output = $('optOutput').value;
  if (output === 'crop' || output === 'both') {
    const v = await tryDownloadVertical(tile, safeName);
    if (v.ok) {
      log('  ✓ Downloaded (vertikal): ' + (v.filename || '').split('/').pop(), 'ok');
      if (output === 'crop') return true;
    } else {
      log('  ! Crop vertikal gagal (' + (v.error || '?') + ').', 'warn');
      if (output === 'crop') {
        // fallback: simpan original agar tidak kehilangan hasil
        const dl = await downloadDirect(tile, safeName);
        if (dl.ok) {
          log('  ! Fallback: original tersimpan (' + (dl.filename || '').split('/').pop() + ').', 'warn');
          return true;
        }
        log('  ✗ Download gagal: ' + (dl.error || '?'), 'err');
        return false;
      }
    }
  }
  if (output === 'flow' || output === 'both') {
    const dl = await downloadDirect(tile, safeName);
    if (!dl.ok) { log('  ✗ Download gagal: ' + (dl.error || '?'), 'err'); return false; }
    log('  ✓ Downloaded: ' + (dl.filename || '').split('/').pop(), 'ok');
    return true;
  }
  return true;
}

// ============ Prompt yang dikirim ke Flow ============
/**
 * Default = DESKRIPTIF LENGKAP (visual + kamera + speed + effect): semua
 * detail DeepSeek dikirim ke Flow. Opsi motion-only hanya utk saat image
 * reference benar-benar terpasang. Narasi tidak digabung — itu script VO.
 */
function buildFlowPrompt(shot) {
  if ($('optPromptMode').value === 'motion') {
    return String(shot.prompt_flow || '').trim();
  }
  const parts = [
    shot.visual, shot.kamera, shot.speed, shot.effect
  ];
  const pf = String(shot.prompt_flow || '').trim();
  // kalau prompt_flow berisi info audio/aksi yang tidak ada di field lain,
  // sertakan sebagai penutup (anti kehilangan info)
  if (pf) parts.push(pf);
  return parts.filter(Boolean).map((s) => String(s).trim()).join('. ');
}

// ============ Salin script format Video_Prompt_Final ============
function buildScriptText() {
  const presetId = $('presetSelect').value;
  const preset = (window.PRESETS || []).find((p) => p.id === presetId) ||
                 S.customPresets.find((p) => p.id === presetId);
  const subject = $('subjectDesc').value.trim();
  const lines = [];
  lines.push('VIDEO PROMPT — ' + (preset ? preset.label : 'Custom'));
  lines.push('='.repeat(60));
  lines.push('Subjek/Produk: ' + (subject || '-'));
  lines.push('Total shot: ' + S.shots.length);
  lines.push('');
  lines.push('NARASI (untuk referensi timing):');
  lines.push('');
  S.shots.forEach((s) => {
    lines.push('[' + (s.ts || '-') + '] "' + (s.narasi || '') + '"');
  });
  lines.push('');
  S.shots.forEach((s) => {
    lines.push('SHOT ' + (s.n || (S.shots.indexOf(s) + 1)) + ' (' + (s.ts || '-') + ')');
    lines.push('NARASI: ' + (s.narasi || ''));
    lines.push('VISUAL:');
    String(s.visual || '').split(/\n|•/).forEach((ln) => {
      const t = ln.trim();
      if (t) lines.push('• ' + t);
    });
    lines.push('Kamera: ' + (s.kamera || ''));
    lines.push('Speed: ' + (s.speed || ''));
    lines.push('EFFECT: ' + (s.effect || ''));
    if (s.fitur) lines.push('FITUR: ' + s.fitur);
    lines.push('');
  });
  return lines.join('\n');
}

async function copyScript() {
  try {
    await navigator.clipboard.writeText(buildScriptText());
    log('Script format Video_Prompt_Final disalin ke clipboard.', 'ok');
  } catch (e) {
    log('Gagal salin: ' + e.message, 'err');
  }
}

/** Diagnosa cepat: apa yang bisa dideteksi di UI Setelan Flow saat ini. */
async function onCheckSettings() {
  const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*'] });
  const flowTab = tabs.find((t) => t.active) || tabs[0];
  if (!flowTab) { log('Buka tab Flow dulu (labs.google/fx).', 'err'); return; }
  S.tabId = flowTab.id;
  if (!await injectContentIfNeeded()) return;
  const d = await sendToContent({ type: 'FLOW_SETTINGS_STATE' });
  if (!d.ok) { log('Gagal diagnosa: ' + (d.error || ''), 'err'); return; }
  log('— DIAGNOSA SETELAN FLOW —', 's');
  log('Tombol Setelan: ' + (d.settingsBtn ? 'ADA ✓' : 'TIDAK ADA ✗'), d.settingsBtn ? 'ok' : 'err');
  log('Section "Default pembuatan video": ' + (d.hasVideoSection ? 'ADA ✓' : 'TIDAK ADA ✗'), d.hasVideoSection ? 'ok' : 'err');
  log('Rasio aktif: ' + (d.activeRatio || 'tidak terdeteksi'), d.activeRatio ? 'ok' : 'warn');
  (d.ratioButtons || []).forEach((b) => {
    log('  Opsi: ' + b.text + ' [' + (b.active ? 'AKTIF' : 'nonaktif') + ']', b.active ? 'ok' : 's');
  });
  if (!(d.ratioButtons || []).length) {
    log('  → Tidak ada tombol rasio terdeteksi. Buka Setelan secara manual & beri tahu saya label tombolnya.', 'err');
  }
  log('— selesai —', 's');
}

// ============ boot ============
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
setBadge('idle');
log('Siap. Isi API key, Generate, lalu Mulai Batch di tab Flow.', 's');
init();
