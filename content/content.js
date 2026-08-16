/**
 * FLOW AI VIDEO GENERATOR - Content Script
 * ----------------------------------------------------------------
 * Berjalan di labs.google/fx. Tugas:
 *  1) Baca state DOM Flow (prompt box, tile video, koordinat) utk batch.
 *  2) Tulis image ke clipboard (Path A injeksi) & simulasi drop (Path B).
 *  Semua aksi "trusted" (ketik, Enter, klik) tetap lewat CDP di background.
 */

(() => {
  if (window.__FLOW_AI_INJECTED__) return;
  window.__FLOW_AI_INJECTED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  // ---------- DOM reads ----------
  function getPromptBox() {
    return $('div[contenteditable="true"][role="textbox"]');
  }

  function btnByText(text, root = document) {
    return $$('button', root).find((b) => {
      const t = (b.innerText || '').trim().split('\n').join(' ').trim();
      return t === text || t.includes(text);
    });
  }

  function getPromptCoords() {
    const b = getPromptBox();
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }

  function getState() {
    const box = getPromptBox();
    return {
      url: location.href,
      hasEditor: !!box,
      generating: !!btnByText('Hentikan'),
      promptText: box ? (box.innerText || '').replace(/\uFEFF/g, '').trim() : ''
    };
  }

  // ---------- clipboard image (Path A) ----------
  async function copyImageToClipboard({ b64, mime, filename }) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime || 'image/png' });
      // ClipboardItem butuh blob ber-mime gambar; PNG/JPEG didukung.
      const item = new ClipboardItem({ [(mime || 'image/png')]: blob });
      await navigator.clipboard.write([item]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
      const ev = new DragEvent('drop', {
        bubbles: true, cancelable: true, composed: true, dataTransfer: dt
      });
      box.dispatchEvent(ev);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------- message handler ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg && msg.type) {
        case 'FLOW_PING':
          return sendResponse({ ok: true });
        case 'FLOW_GET_STATE':
          return sendResponse({ ok: true, state: getState() });
        case 'FLOW_FOCUS_PROMPT':
          {
            const box = getPromptBox();
            if (box) { box.focus(); return sendResponse({ ok: true, coords: getPromptCoords() }); }
            return sendResponse({ ok: false, error: 'prompt box tidak ditemukan' });
          }
        case 'FLOW_COPY_IMAGE':
          return sendResponse(await copyImageToClipboard(msg));
        case 'FLOW_DROP_IMAGE':
          return sendResponse(dropImage(msg));
        case 'FLOW_GET_PROMPT_COORDS':
          return sendResponse({ ok: true, coords: getPromptCoords() });
        default:
          return sendResponse({ ok: false, reason: 'unknown: ' + msg.type });
      }
    })();
    return true; // async
  });

  console.log('[FlowAI] content script siap');
})();
