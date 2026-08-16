/**
 * FLOW AI VIDEO GENERATOR - Image Reference Injection
 * ----------------------------------------------------------------
 * Temuan penting dari probe & uji user:
 *  - `input[accept*=image]` (Add Media) = upload MEDIA ke project,
 *    BUKAN attach reference ke prompt → Path itu TIDAK membuat gambar
 *    dipakai sebagai referensi.
 *  - Image reference SEJATI = paste/drop gambar ke PROMPT BOX
 *    (dibuktikan manual user: thumbnail muncul di atas kolom prompt).
 *
 * Urutan jalur (PRIMARY dulu):
 *   Path P : paste-event sintetik (ClipboardEvent + DataTransfer File)
 *            ke prompt box — TANPA clipboard OS, TANPA izin, TANPA fokus.
 *   Path B : drop-event sintetik (DragEvent + DataTransfer File) ke box.
 *   Path A : clipboard OS via CDP Runtime.evaluate + Ctrl+V trusted.
 *   Path C : DOM.setFileInputFiles (media project — referensi TIDAK
 *            dijamin; terakhir saja).
 */

'use strict';

import { CDP_TARGET, cdp, cdpPaste } from './cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inject image reference ke prompt box Flow.
 * @param {object} img { b64, mime, filename }
 * @returns {Promise<{ok:boolean, path:string, verified?:boolean, error?:string}>}
 */
export async function injectImage(img) {
  const { b64, mime, filename } = img || {};
  if (!b64) return { ok: false, path: 'none', error: 'tidak ada gambar' };

  // Path P (PRIMARY): paste-event sim ke prompt box
  const rP = await tryPasteEvent(b64, mime, filename);
  if (rP.ok) return { ok: true, path: 'P-paste-event', verified: rP.verified };
  const errP = rP.error;

  // Path B: drop-event sim
  const rB = await tryDropEvent(b64, mime, filename);
  if (rB.ok) return { ok: true, path: 'B-drop-event', verified: rB.verified };
  const errB = rB.error;

  // Path A: clipboard OS + Ctrl+V
  const rA = await tryClipboardPaste(b64, mime, filename);
  if (rA.ok) return { ok: true, path: 'A-clipboard-paste', verified: rA.verified };
  const errA = rA.error;

  // Path C: setFileInputFiles (media project — jalur terakhir)
  const rC = await trySetFileInput(b64, mime, filename);
  if (rC.ok) return { ok: true, path: 'C-setFileInputFiles (media project, referensi tidak dijamin)', verified: rC.verified };
  const errC = rC.error;

  return { ok: false, path: 'none', error: 'P:' + (errP || '?') + ' | B:' + (errB || '?') + ' | A:' + (errA || '?') + ' | C:' + (errC || '?') };
}

/** Hitung img di halaman (verifikasi thumbnail: total img ATAU blob/data naik). */
async function countImages() {
  const r = await sendToContent('FLOW_COUNT_IMAGES');
  return r.ok ? r : { ok: false, allImgs: -1, blobImgs: -1 };
}

/** True jika jumlah img bertambah setelah paste (thumbnail muncul). */
function imagesIncreased(before, after) {
  if (!before.ok || !after.ok) return false;
  return after.allImgs > before.allImgs || after.blobImgs > before.blobImgs;
}

// ============ Path P — paste-event sintetik (PRIMARY) ============
async function tryPasteEvent(b64, mime, filename) {
  try {
    const before = await countImages();
    const r = await sendToContent('FLOW_PASTE_IMAGE', { b64, mime, filename });
    if (!r.ok) return { ok: false, error: r.error };
    await sleep(3000); // React memproses async
    const after = await countImages();
    return { ok: true, verified: imagesIncreased(before, after) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ Path B — drop-event sintetik ============
async function tryDropEvent(b64, mime, filename) {
  try {
    const before = await countImages();
    const r = await sendToContent('FLOW_DROP_IMAGE', { b64, mime, filename });
    if (!r.ok) return { ok: false, error: r.error };
    await sleep(3000);
    const after = await countImages();
    return { ok: true, verified: imagesIncreased(before, after) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ Path A — clipboard OS via CDP ============
async function tryClipboardPaste(b64, mime, filename) {
  try {
    if (CDP_TARGET.tabId != null) {
      await chrome.tabs.update(CDP_TARGET.tabId, { active: true });
      await sleep(600);
    }
    try {
      await cdp('Browser.grantPermissions', {
        origin: 'https://labs.google',
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      });
    } catch (e) { /* abaikan */ }

    const wr = await cdpCopyImageToClipboard(b64, mime);
    if (!wr.ok) return { ok: false, error: 'clipboard write gagal: ' + wr.error };
    await sleep(400);

    const before = await countImages();
    const focus = await sendToContent('FLOW_FOCUS_PROMPT');
    if (!focus.ok) return { ok: false, error: 'prompt box tidak ditemukan' };
    await sleep(300);

    const paste = await cdpPaste();
    if (!paste.ok) return { ok: false, error: paste.error };
    await sleep(2500);

    const after = await countImages();
    return { ok: true, verified: imagesIncreased(before, after) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
      return JSON.stringify({ ok: true });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
    }
  })()`;
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (!r.ok) return { ok: false, error: r.error };
  const val = r.result && r.result.result && r.result.result.value;
  try {
    const parsed = JSON.parse(val);
    return parsed.ok ? { ok: true } : { ok: false, error: parsed.error };
  } catch (e) {
    return { ok: false, error: 'respons clipboard tidak dikenali' };
  }
}

// ============ Path C — setFileInputFiles (media project, TERAKHIR) ============
async function trySetFileInput(b64, mime, filename) {
  try {
    const ext = String(mime || '').includes('png') ? 'png' : 'jpg';
    const path = await saveTempFile(`data:${mime || 'image/png'};base64,${b64}`, ext);
    if (!path) return { ok: false, error: 'gagal menulis file temp ke Downloads' };

    const doc = await cdp('DOM.getDocument', { depth: -1, pierce: true });
    if (!doc.ok) return { ok: false, error: 'DOM.getDocument: ' + doc.error };
    const q = await cdp('DOM.querySelector', {
      nodeId: doc.result.root.nodeId,
      selector: 'input[type=file][accept*=image]'
    });
    if (!q.ok || !q.result || !q.result.nodeId) {
      return { ok: false, error: 'input[accept*=image] tidak ditemukan di DOM Flow' };
    }
    const sf = await cdp('DOM.setFileInputFiles', { files: [path], nodeId: q.result.nodeId });
    if (!sf.ok) return { ok: false, error: 'DOM.setFileInputFiles: ' + sf.error };
    await sleep(2500);

    const chk = await cdp('Runtime.evaluate', {
      expression: `document.querySelector('input[type=file][accept*=image]') && document.querySelector('input[type=file][accept*=image]').files.length`,
      returnByValue: true
    });
    const n = chk.ok && chk.result && chk.result.result && chk.result.result.value;
    return { ok: true, verified: n > 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function saveTempFile(dataUrl, ext) {
  return new Promise((resolve) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: 'flow-ai-video-generator/ref_image.' + ext,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (id) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve(null);
      const t0 = Date.now();
      const iv = setInterval(() => {
        chrome.downloads.search({ id }, (items) => {
          if (!items.length) return;
          const it = items[0];
          if (it.state === 'complete') { clearInterval(iv); resolve(it.filename); }
          else if (it.state === 'interrupted' || Date.now() - t0 > 30000) {
            clearInterval(iv); resolve(null);
          }
        });
      }, 500);
    });
  });
}

function sendToContent(type, data = {}) {
  return new Promise((resolve) => {
    const send = (tabId) => {
      chrome.tabs.sendMessage(tabId, { type, ...data }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return resolve({ ok: false, error: err.message });
        resolve(resp || { ok: false, error: 'no response' });
      });
    };
    if (CDP_TARGET.tabId != null) return send(CDP_TARGET.tabId);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      if (!tabId) return resolve({ ok: false, error: 'tidak ada tab aktif' });
      send(tabId);
    });
  });
}
