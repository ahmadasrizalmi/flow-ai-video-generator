/**
 * FLOW AI VIDEO GENERATOR - Image Reference Injection
 * ----------------------------------------------------------------
 * Strategi (hasil probe 2026-08-16, KASUS A terkonfirmasi):
 *   Path A (utama) : tulis image ke clipboard LEWAT CDP (Runtime.evaluate
 *                    di main world + Browser.grantPermissions) → fokus tab
 *                    Flow → Ctrl+V trusted di prompt box. Ini mengatasi
 *                    masalah "Document is not focused" dari content script.
 *   Path B (cadang): drop sim DataTransfer+File(base64) di prompt box
 *                    (React onDrop aktif).
 *   Path C (akhir) : klik "Add Media" → Page.fileChooserOpened →
 *                    DOM.setFileInputFiles (butuh path lokal).
 */

'use strict';

import { CDP_TARGET, cdp, cdpPaste } from './cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inject image reference ke Flow.
 * @param {object} img { b64, mime, filename }
 * @returns {Promise<{ok:boolean, path:string, verified?:boolean, error?:string}>}
 */
export async function injectImage(img) {
  const { b64, mime, filename } = img || {};
  if (!b64) return { ok: false, path: 'none', error: 'tidak ada gambar' };

  // Path A: clipboard (via CDP main world) + trusted paste
  const rA = await tryClipboardPaste(b64, mime, filename);
  if (rA.ok) return { ok: true, path: 'A-clipboard-paste', verified: rA.verified };

  // Path B: drop simulation
  const rB = await tryDropSimulation(b64, mime, filename);
  if (rB.ok) return { ok: true, path: 'B-drop-sim' };

  // Path C: klik Add Media + file chooser (perlu file fisik)
  const rC = await tryFileChooser();
  if (rC.ok) return { ok: true, path: 'C-file-chooser' };

  return { ok: false, path: 'none', error: rA.error || 'semua path injeksi gagal' };
}

/** Path A: CDP clipboard write (main world) → Ctrl+V trusted. */
async function tryClipboardPaste(b64, mime, filename) {
  try {
    // 0. fokus tab Flow — document harus focused utk clipboard.write
    if (CDP_TARGET.tabId != null) {
      await chrome.tabs.update(CDP_TARGET.tabId, { active: true });
      await sleep(600);
    }

    // 1. grant izin clipboard via CDP (non-fatal bila tidak didukung)
    try {
      await cdp('Browser.grantPermissions', {
        origin: 'https://labs.google',
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      });
    } catch (e) { /* abaikan */ }

    // 2. tulis image ke clipboard di main world (document ter-fokus)
    const wr = await cdpCopyImageToClipboard(b64, mime);
    if (!wr.ok) return { ok: false, error: 'clipboard write gagal: ' + wr.error };
    await sleep(400);

    // 3. hitung blob image sebelum paste (verifikasi)
    const before = await sendToContent('FLOW_COUNT_IMAGES');

    // 4. fokus prompt box
    const focus = await sendToContent('FLOW_FOCUS_PROMPT');
    if (!focus.ok) return { ok: false, error: 'prompt box tidak ditemukan' };
    await sleep(300);

    // 5. Ctrl+V trusted via CDP
    const paste = await cdpPaste();
    if (!paste.ok) return { ok: false, error: paste.error };
    await sleep(2000);

    // 6. verifikasi: blob image bertambah (thumbnail muncul)
    const after = await sendToContent('FLOW_COUNT_IMAGES');
    const verified = before.ok && after.ok && after.blobImgs > before.blobImgs;
    return { ok: true, verified };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Tulis image ke clipboard via CDP Runtime.evaluate di main world. */
async function cdpCopyImageToClipboard(b64, mime) {
  const expr = `(async () => {
    try {
      const b64 = ${JSON.stringify(b64)};
      const mime = ${JSON.stringify(mime || 'image/png')};
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const item = new ClipboardItem({ [mime]: blob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (e) { return false; }
  })()`;
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (!r.ok) return { ok: false, error: r.error };
  const val = r.result && r.result.result && r.result.result.value;
  return val ? { ok: true } : { ok: false, error: 'Runtime.evaluate false' };
}

/** Path B: content script simulasi drop DataTransfer ke prompt box. */
async function tryDropSimulation(b64, mime, filename) {
  const r = await sendToContent('FLOW_DROP_IMAGE', { b64, mime, filename });
  if (!r.ok) return { ok: false, error: r.error };
  await sleep(1500);
  return { ok: true };
}

/** Path C: klik tombol "Add Media" lalu set file via file chooser (path lokal). */
async function tryFileChooser() {
  // TODO: butuh file fisik + Page.setInterceptFileChooserDialog.
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
