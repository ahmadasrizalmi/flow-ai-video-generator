/**
 * FLOW AI VIDEO GENERATOR - Image Reference Injection
 * ----------------------------------------------------------------
 * Strategi (hasil probe 2026-08-16, KASUS A terkonfirmasi):
 *   Path A (utama) : content script tulis ClipboardItem image → CDP Ctrl+V
 *                    trusted di prompt box (reproduksi uji manual user
 *                    yang terbukti muncul thumbnail).
 *   Path B (cadang): drop sim DataTransfer+File(base64) di prompt box
 *                    (React onDrop aktif).
 *   Path C (akhir) : klik "Add Media" → Page.fileChooserOpened →
 *                    DOM.setFileInputFiles (butuh path lokal; hanya bila
 *                    image tersimpan sebagai file fisik).
 *
 * Semua path dikirim lewat message ke content script / dipicu CDP.
 */

'use strict';

import { cdp, cdpPaste, cdpClick } from './cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inject image reference ke Flow.
 * @param {object} img { b64, mime, filename }
 * @param {object} opts { promptBoxCoords:{x,y} }
 * @returns {Promise<{ok:boolean, path:string, error?:string}>}
 */
export async function injectImage(img, opts = {}) {
  const { b64, mime, filename } = img;
  if (!b64) return { ok: false, path: 'none', error: 'tidak ada gambar' };

  // Path A: clipboard + trusted paste
  const rA = await tryClipboardPaste(b64, mime, filename, opts);
  if (rA.ok) return { ok: true, path: 'A-clipboard-paste' };

  // Path B: drop simulation
  const rB = await tryDropSimulation(b64, mime, filename, opts);
  if (rB.ok) return { ok: true, path: 'B-drop-sim' };

  // Path C: klik Add Media + file chooser (perlu file fisik)
  const rC = await tryFileChooser(opts);
  if (rC.ok) return { ok: true, path: 'C-file-chooser' };

  return { ok: false, path: 'none', error: 'semua path injeksi gagal' };
}

/** Path A: minta content script menulis image ke clipboard, lalu Ctrl+V. */
async function tryClipboardPaste(b64, mime, filename, opts) {
  try {
    // 1. fokus prompt box (content script)
    const focus = await sendToContent('FLOW_FOCUS_PROMPT');
    if (!focus.ok) return { ok: false, error: 'prompt box tidak ditemukan' };

    // 2. content script menulis image ke clipboard (perlu izin clipboardWrite)
    const wr = await sendToContent('FLOW_COPY_IMAGE', { b64, mime, filename });
    if (!wr.ok) return { ok: false, error: 'clipboard write gagal: ' + wr.error };

    await sleep(300);

    // 3. Ctrl+V trusted via CDP
    const paste = await cdpPaste();
    if (!paste.ok) return { ok: false, error: paste.error };

    await sleep(1500);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Path B: content script simulasi drop DataTransfer ke prompt box. */
async function tryDropSimulation(b64, mime, filename, opts) {
  const r = await sendToContent('FLOW_DROP_IMAGE', { b64, mime, filename });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

/** Path C: klik tombol "Add Media" lalu set file via file chooser (path lokal). */
async function tryFileChooser(opts) {
  // TODO: butuh file fisik + Page.setInterceptFileChooserDialog.
  // Jarang dipakai karena panel hanya punya base64. Implement bila perlu.
  return { ok: false, error: 'path C belum diimplementasikan (butuh file fisik)' };
}

function sendToContent(type, data = {}) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      if (!tabId) return resolve({ ok: false, error: 'tidak ada tab aktif' });
      chrome.tabs.sendMessage(tabId, { type, ...data }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return resolve({ ok: false, error: err.message });
        resolve(resp || { ok: false, error: 'no response' });
      });
    });
  });
}
