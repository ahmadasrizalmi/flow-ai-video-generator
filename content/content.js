/**
 * FLOW AI VIDEO GENERATOR - Content Script
 * ----------------------------------------------------------------
 * Berjalan di labs.google/fx. Tugas:
 *  1) Baca state DOM Flow (prompt box, tile video, koordinat) utk batch.
 *  2) Tulis image ke clipboard (Path A injeksi) & simulasi drop (Path B).
 *  3) Operasi kecil yang aman sintetik (tutup detail, dismiss modal).
 *  Aksi "trusted" (ketik, Enter, klik submit) tetap lewat CDP di background.
 */

(() => {
  if (window.__FLOW_AI_INJECTED__) return;
  window.__FLOW_AI_INJECTED__ = true;

  const CFG = {
    promptBoxSelector: 'div[contenteditable="true"][role="textbox"]',
    submitButtonClass: 'sc-5c3af813',
    submitButtonText: 'Buat',
    stopButtonText: 'Hentikan',
    downloadButtonText: 'Download',
    closeDetailText: 'Selesai',
    videoThumbAlt: 'Thumbnail video',
    mediaUrlTypeVideo: 'MEDIA_URL_TYPE_THUMBNAIL',
    mediaBaseUrl: 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect'
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const btnByText = (text, root = document) => {
    return $$('button', root).find((b) => {
      const t = (b.innerText || '').trim().split('\n').join(' ').trim();
      return t === text || t.includes(text);
    });
  };

  // ---------- DOM reads ----------
  function getPromptBox() { return $(CFG.promptBoxSelector); }

  function getPromptCoords() {
    const b = getPromptBox();
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }

  function isGenerating() { return !!btnByText(CFG.stopButtonText); }

  function hasSubmitBtn() {
    const b = $$('button').find((x) => (x.className || '').includes(CFG.submitButtonClass));
    return !!b && isVisible(b);
  }

  function getPromptText() {
    const b = getPromptBox();
    return b ? (b.innerText || '').replace(/\uFEFF/g, '').trim() : '';
  }

  /** Tile video di canvas: img dgn src getMediaUrlRedirect + uuid. */
  function getVideoTiles() {
    const tiles = [];
    const seen = new Set();
    $$('img').forEach((img) => {
      const src = img.src || '';
      if (!src.includes('getMediaUrlRedirect')) return;
      const alt = img.getAttribute('alt') || '';
      const m = src.match(/[?&]name=([0-9a-f-]{36})/);
      const uuid = m ? m[1] : null;
      if (!uuid || seen.has(uuid)) return;
      const isVideo = alt === CFG.videoThumbAlt ||
                      src.includes(CFG.mediaUrlTypeVideo) ||
                      src.includes('MEDIA_URL_TYPE_VIDEO');
      let clickable = null;
      let cur = img;
      for (let i = 0; i < 6 && cur; i++) {
        cur = cur.parentElement;
        if (!cur) break;
        if (cur.tagName === 'A' || cur.getAttribute('role') === 'button' || cur.tagName === 'BUTTON') {
          clickable = cur; break;
        }
      }
      const rect = (clickable || img).getBoundingClientRect();
      tiles.push({
        uuid, src, alt, isVideo,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        visible: isVisible(clickable || img)
      });
      seen.add(uuid);
    });
    return tiles;
  }

  /** Tile yang sedang ber-progress % / gagal (untuk deteksi canvas sibuk). */
  function getGeneratingTiles() {
    const out = [];
    $$('*').forEach((el) => {
      if (el.children.length !== 0) return;
      const t = (el.textContent || '').trim();
      if (!/^\d{1,3}%$/.test(t)) return;
      let cur = el;
      for (let i = 0; i < 6 && cur; i++) {
        cur = cur.parentElement;
        if (!cur) break;
        const txt = (cur.innerText || '');
        if (/Gagal/.test(txt)) { out.push({ stage: 'failed', text: txt.slice(0, 120), pct: t }); return; }
        if (/play_circle|play_arrow/.test(txt) || /^\d+%/.test(txt)) { out.push({ stage: 'progress', text: txt.slice(0, 120), pct: t }); return; }
      }
    });
    return out;
  }

  function getState() {
    return {
      url: location.href,
      hasEditor: !!getPromptBox(),
      promptText: getPromptText(),
      generating: isGenerating(),
      hasSubmit: hasSubmitBtn(),
      videoTiles: getVideoTiles(),
      generatingTiles: getGeneratingTiles(),
      hasDetailView: !!btnByText(CFG.closeDetailText),
      hasDownloadBtn: !!btnByText(CFG.downloadButtonText),
      privacyModal: !!$$('[role="dialog"]').find((d) => (d.innerText || '').includes('kebijakan'))
    };
  }

  /** Koordinat elemen utk CDP trusted click. */
  function getElementCoords(desc = {}) {
    if (desc.promptBox) { const c = getPromptCoords(); if (c) return { ...c, tag: 'promptBox' }; }
    if (desc.submitBtn) {
      const b = $$('button').find((x) => (x.className || '').includes(CFG.submitButtonClass));
      if (b && isVisible(b)) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: 'submit' }; }
    }
    if (desc.downloadBtn) {
      const b = btnByText(CFG.downloadButtonText);
      if (b && isVisible(b)) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: 'download' }; }
    }
    if (desc.closeDetail) {
      const b = btnByText(CFG.closeDetailText);
      if (b && isVisible(b)) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: 'closeDetail' }; }
    }
    if (desc.videoTile && desc.uuid) {
      const t = getVideoTiles().find((x) => x.uuid === desc.uuid);
      if (t) return { x: t.x, y: t.y, tag: 'videoTile:' + desc.uuid };
    }
    return null;
  }

  // ---------- Setelan agen Flow: rasio video (16:9 / 9:16) ----------
  function getSettingsButton() {
    const txt = 'Setelan';
    let b = $$('button').find((x) => (x.innerText || '').includes(txt) && (x.className || '').toString().includes('sc-c4e423a0'));
    if (!b || !isVisible(b)) {
      b = $$('button').find((x) => (x.innerText || '').trim() === txt && isVisible(x));
    }
    return (b && isVisible(b)) ? b : null;
  }

  function findVideoSection() {
    let header = null;
    for (const el of $$('*')) {
      if (el.children.length === 0 && (el.innerText || '').trim() === 'Default pembuatan video') header = el;
    }
    if (!header) return null;
    let root = header.parentElement;
    for (let i = 0; i < 8 && root; i++) {
      if ((root.innerText || '').includes('Omni Flash')) break;
      root = root.parentElement;
    }
    return root;
  }

  function getVideoRatioButtons() {
    const sec = findVideoSection();
    if (!sec) return [];
    return $$('button', sec).filter((b) => {
      const txt = (b.innerText || '').trim().replace(/\s+/g, ' ');
      return /crop_(landscape|portrait|square)\b/i.test(txt) ||
             /(?:^|\s)(16\s*:\s*9|9\s*:\s*16|1\s*:\s*1)(?:\s|$)/i.test(txt) ||
             /(16\s*:\s*9|9\s*:\s*16).{0,20}(landscape|portrait)/i.test(txt);
    });
  }

  function getActiveVideoRatio() {
    const btns = getVideoRatioButtons();
    const active = btns.find((b) =>
      b.getAttribute('data-state') === 'active' ||
      b.getAttribute('aria-pressed') === 'true' ||
      b.getAttribute('aria-selected') === 'true'
    );
    return active ? (active.innerText || '').trim().split('\n').join(' ').replace(/^crop_\S+\s*/, '') : null;
  }

  function openSettingsPanel() {
    const b = getSettingsButton();
    if (b) { syntheticClick(b); return true; }
    return false;
  }

  // ---------- operasi sintetik aman ----------
  function syntheticClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  /** Fallback set prompt via execCommand (bila CDP insertText gagal). */
  function setPromptText(text) {
    const box = getPromptBox();
    if (!box) return { ok: false, reason: 'no prompt box' };
    box.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
    try { document.execCommand('delete', false, null); } catch (e) {}
    try { document.execCommand('insertText', false, text); } catch (e) { box.innerText = text; }
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return { ok: true, text: box.innerText };
  }

  /** Tutup modal privasi + onboarding bila muncul. */
  async function dismissModals() {
    const dlg = $$('[role="dialog"]').find((d) => (d.innerText || '').includes('kebijakan'));
    if (dlg) {
      $$('*', dlg).forEach((el) => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
      for (let i = 0; i < 10; i++) {
        const btn = btnByText('Lanjutkan', dlg);
        if (btn && !btn.disabled) { syntheticClick(btn); await sleep(800); } else break;
      }
    }
    for (let i = 0; i < 6; i++) {
      const b = ['Mulai', 'Berikutnya', 'Selesai'].map((t) => btnByText(t)).find((x) => x && isVisible(x));
      if (!b) break;
      syntheticClick(b); await sleep(600);
    }
    return { ok: true };
  }

  // ---------- clipboard image (Path A) ----------
  async function copyImageToClipboard({ b64, mime, filename }) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime || 'image/png' });
      const item = new ClipboardItem({ [(mime || 'image/png')]: blob });
      await navigator.clipboard.write([item]);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---------- drop simulation (Path B) ----------
  function dropImage({ b64, mime, filename }) {
    const box = getPromptBox();
    if (!box) return { ok: false, error: 'prompt box tidak ditemukan' };
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], filename || 'reference.png', { type: mime || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      box.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---------- diagnostics ----------
  function abToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function scanPage() {
    const out = { state: getState(), findings: {} };
    const box = getPromptBox();
    out.findings.promptBox = box ? { tag: box.tagName, cls: box.className.toString().slice(0, 80) } : null;
    const submit = $$('button').find((x) => (x.className || '').includes(CFG.submitButtonClass));
    out.findings.submitBtn = submit ? { text: (submit.innerText || '').trim().split('\n').join(' '), cls: submit.className.toString().slice(0, 60) } : null;
    out.findings.stopBtn = isGenerating() ? 'ada' : null;
    out.findings.downloadBtn = btnByText(CFG.downloadButtonText) ? 'ada' : null;
    out.findings.closeDetail = btnByText(CFG.closeDetailText) ? 'ada' : null;
    out.findings.videoThumbs = $$('img').filter((i) => (i.getAttribute('alt') || '') === CFG.videoThumbAlt).length;
    out.findings.mediaCount = $$('img').filter((i) => (i.src || '').includes('getMediaUrlRedirect')).length;
    out.findings.dialogs = $$('[role="dialog"]').map((d) => (d.innerText || '').slice(0, 60));
    return out;
  }

  // ---------- message handler ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg && msg.type) {
        case 'FLOW_PING':
          return sendResponse({ ok: true });
        case 'FLOW_GET_STATE':
          return sendResponse({ ok: true, state: getState() });
        case 'FLOW_SCAN':
          return sendResponse({ ok: true, ...scanPage() });
        case 'FLOW_FOCUS_PROMPT':
        case 'FLOW_SUBMIT_PREP':
          {
            const box = getPromptBox();
            if (box) { box.focus(); return sendResponse({ ok: true, coords: getPromptCoords() }); }
            return sendResponse({ ok: false, error: 'prompt box tidak ditemukan' });
          }
        case 'FLOW_SET_PROMPT':
          return sendResponse(setPromptText(msg.text || ''));
        case 'FLOW_GET_PROMPT_COORDS':
          return sendResponse({ ok: true, coords: getPromptCoords() });
        case 'FLOW_GET_COORDS':
          return sendResponse({ ok: true, coords: getElementCoords(msg.desc || {}) });
        case 'FLOW_CLOSE_DETAIL':
          {
            const b = btnByText(CFG.closeDetailText);
            if (b && isVisible(b)) syntheticClick(b);
            return sendResponse({ ok: true });
          }
        case 'FLOW_COUNT_IMAGES':
          // jumlah img blob:/data: (untuk verifikasi paste thumbnail)
          return sendResponse({ ok: true, blobImgs: $$('img').filter((i) => /^(blob:|data:)/.test(i.src || '')).length });
        case 'FLOW_FETCH_MEDIA': {
          // Ambil file media SAME-ORIGIN (cookie Flow otomatis terkirim),
          // redirect signed URL tetap diikuti. Kirim base64 utk di-crop vertikal.
          try {
            const resp = await fetch(msg.url, { credentials: 'same-origin', redirect: 'follow' });
            if (!resp.ok) return sendResponse({ ok: false, error: 'HTTP ' + resp.status });
            const buf = await resp.arrayBuffer();
            const max = 100 * 1024 * 1024;
            if (buf.byteLength > max) {
              return sendResponse({ ok: false, error: 'media terlalu besar (' + Math.round(buf.byteLength / 1048576) + ' MB)' });
            }
            return sendResponse({
              ok: true,
              data: abToB64(buf),
              size: buf.byteLength,
              mime: resp.headers.get('content-type') || 'video/mp4'
            });
          } catch (e) {
            return sendResponse({ ok: false, error: e.message });
          }
        }
        case 'FLOW_OPEN_SETTINGS':
          return sendResponse({ ok: openSettingsPanel() });
        case 'FLOW_SETTINGS_OPEN':
          return sendResponse({ ok: !!findVideoSection() });
        case 'FLOW_GET_SETTINGS_COORDS':
          {
            const b = getSettingsButton();
            if (!b) return sendResponse({ ok: false, reason: 'tombol Setelan tidak ditemukan' });
            const r = b.getBoundingClientRect();
            return sendResponse({ ok: true, coords: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } });
          }
        case 'FLOW_GET_ACTIVE_RATIO':
          return sendResponse({ ok: true, ratio: getActiveVideoRatio() });
        case 'FLOW_GET_RATIO_COORDS': {
          const want = String(msg.ratio || '');
          const b = getVideoRatioButtons().find((x) =>
            (x.innerText || '').includes(want) && x.getAttribute('data-state') !== 'active'
          );
          if (!b || !isVisible(b)) return sendResponse({ ok: false, reason: 'rasio tidak ditemukan / sudah aktif' });
          try { b.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
          await sleep(400);
          const r = b.getBoundingClientRect();
          return sendResponse({ ok: true, coords: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }, dataState: b.getAttribute('data-state') });
        }
        case 'FLOW_GET_SAVE_COORDS':
          {
            const b = btnByText('Simpan');
            if (!b || !isVisible(b)) return sendResponse({ ok: false, reason: 'tombol Simpan tidak terlihat' });
            const r = b.getBoundingClientRect();
            return sendResponse({ ok: true, coords: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } });
          }
        case 'FLOW_CLOSE_SETTINGS': {
          const btns = $$('button').filter(isVisible);
          const back = btns.find((b) => (b.innerText || '').includes('Kembali') && (b.className || '').includes('sc-b9a'));
          const close = btns.find((b) => (b.innerText || '').includes('Tutup'));
          if (findVideoSection() && (back || close)) {
            syntheticClick(back || close);
            return sendResponse({ ok: true, closed: true });
          }
          return sendResponse({ ok: true, closed: false });
        }
        case 'FLOW_DISMISS_MODALS':
          return sendResponse(await dismissModals());
        case 'FLOW_COPY_IMAGE':
          return sendResponse(await copyImageToClipboard(msg));
        case 'FLOW_DROP_IMAGE':
          return sendResponse(dropImage(msg));
        default:
          return sendResponse({ ok: false, reason: 'unknown: ' + msg.type });
      }
    })();
    return true; // async
  });

  console.log('[FlowAI] content script siap');
})();
