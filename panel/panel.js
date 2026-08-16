/**
 * FLOW AI VIDEO GENERATOR - Panel (Orkestrator)
 * ----------------------------------------------------------------
 * Alur: isi API key → pilih preset → deskripsi subjek → upload image
 * (opsional) → Generate (DeepSeek via bg) → preview shot → Mulai Batch
 * (CDP ke Flow + injeksi image).
 *
 * Batch runner detail diimplementasikan bertahap (lihat ARCHITECTURE.md
 * §6 & §8) — skeleton fungsi sudah disiapkan.
 */

'use strict';

const S = {
  tabId: null,
  running: false,
  stopRequested: false,
  shots: [],
  processed: 0,
  failed: 0,
  image: null, // { b64, mime, filename } dari upload panel
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

// ============ init ============
async function init() {
  // preset dropdown: bawaan + custom
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
  // API key
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
    // simpan ke bg utk dipakai batch
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

  // pakai custom preset bila id-nya custom
  const preset = (window.PRESETS || []).find((p) => p.id === presetId) ||
                 S.customPresets.find((p) => p.id === presetId);
  const system = window.buildSystemPrompt({ presetId: presetId, syari });
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

// ============ Batch ke Flow (skeleton — diimplementasikan bertahap) ============
async function onBatch() {
  if (S.running) return;
  if (!S.shots.length) return log('Generate dulu sebelum batch.', 'err');

  // 1. cari tab Flow aktif
  const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*'] });
  const flowTab = tabs.find((t) => t.active) || tabs[0];
  if (!flowTab) return log('Buka tab Google Flow dulu (labs.google/fx).', 'err');
  S.tabId = flowTab.id;

  // 2. attach debugger
  const att = await sendToBg({ type: 'BG_ATTACH', tabId: S.tabId });
  if (!att.ok) { setBadge('err'); return log('Debugger gagal attach: ' + att.error, 'err'); }
  log('Debugger terhubung ke tab Flow.');

  // 3. inject image reference (sekali di awal batch)
  if (S.image) {
    log('Inject image reference…');
    const inj = await sendToBg({ type: 'INJ_IMAGE', img: S.image });
    log(inj.ok ? 'Image terpasang (' + inj.path + ')' : 'Image gagal: ' + inj.error, inj.ok ? 'ok' : 'err');
    await sleep(1500);
  }

  // 4. jalankan shot (detail: lihat TODO batch runner)
  S.running = true; S.stopRequested = false; S.processed = 0; S.failed = 0;
  setBadge('run');
  for (const shot of S.shots) {
    if (S.stopRequested) break;
    await runOneShot(shot);
  }
  S.running = false;
  setBadge('ok');
  log(`Batch selesai: ${S.processed} sukses, ${S.failed} gagal.`);
}

/** Satu shot: set prompt → enter → tunggu selesai → download. */
async function runOneShot(shot) {
  // TODO (bertahap, lihat ARCHITECTURE.md §6):
  //  1. FLOW_FOCUS_PROMPT via content script
  //  2. BG_TYPE_TEXT (prompt_flow)
  //  3. BG_PRESS_ENTER
  //  4. poll state generating=false + tile video baru muncul
  //  5. trigger download via chrome.downloads (getMediaUrlRedirect)
  log('Shot ' + (S.processed + S.failed + 1) + ': ' + (shot.prompt_flow || '').slice(0, 80) + '…');
  await sleep(1); // placeholder sampai runner diimplementasikan
  S.processed++;
}

// ============ boot ============
init();
