/**
 * FLOW AI VIDEO GENERATOR - Image Reference Injection
 * ----------------------------------------------------------------
 * Strategi (hasil probe 2026-08-16, KASUS A terkonfirmasi):
 *   Path C (UTAMA) : tulis image ke file temp via chrome.downloads
 *                    (data URL → path disk) lalu DOM.setFileInputFiles
 *                    ke <input type=file accept*=image> hidden — CDP
 *                    memicu onChange React Flow, paling andal & TIDAK
 *                    butuh clipboard/fokus.
 *   Path A (cadang): clipboard via CDP Runtime.evaluate (main world) +
 *                    Ctrl+V trusted di prompt box.
 *   Path B (akhir) : drop sim DataTransfer+File(base64) di prompt box.
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

  // Path C (PRIMARY): file temp + DOM.setFileInputFiles
  const rC = await trySetFileInput(b64, mime, filename);
  if (rC.ok) return { ok: true, path: 'C-setFileInputFiles', verified: rC.verified };
  const errC = rC.error;

  // Path A: clipboard via CDP main world + Ctrl+V
  const rA = await tryClipboardPaste(b64, mime, filename);
  if (rA.ok) return { ok: true, path: 'A-clipboard-paste', verified: rA.verified };

  // Path B: drop sim
  const rB = await tryDropSimulation(b64, mime, filename);
  if (rB.ok) return { ok: true, path: 'B-drop-sim' };

  return { ok: false, path: 'none', error: 'C: ' + (errC || '?') + ' | A: ' + (rA.error || '?') + ' | B: ' + (rB.error || '?') };
}

// ============ Path C — setFileInputFiles (PRIMARY) ============
async function trySetFileInput(b64, mime, filename) {
  try {
    // 1. tulis file temp via chrome.downloads (data URL → path disk)
    const ext = String(mime || '').includes('png') ? 'png' : 'jpg';
    const path = await saveTempFile(`data:${mime || 'image/png'};base64,${b64}`, ext);
    if (!path) return { ok: false, error: 'gagal menulis file temp ke Downloads' };

    // 2. resolve nodeId input[type=file][accept*=image]
    const doc = await cdp('DOM.getDocument', { depth: -1, pierce: true });
    if (!doc.ok) return { ok: false, error: 'DOM.getDocument: ' + doc.error };
    const q = await cdp('DOM.querySelector', {
      nodeId: doc.result.root.nodeId,
      selector: 'input[type=file][accept*=image]'
    });
    if (!q.ok || !q.result || !q.result.nodeId) {
      return { ok: false, error: 'input[accept*=image] tidak ditemukan di DOM Flow' };
    }

    // 3. set files (memicu onChange React → Flow memproses media)
    const sf = await cdp('DOM.setFileInputFiles', { files: [path], nodeId: q.result.nodeId });
    if (!sf.ok) return { ok: false, error: 'DOM.setFileInputFiles: ' + sf.error };
    await sleep(2500);

    // 4. verifikasi: input punya 1 file
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

/** Simpan base64 → file PNG/JPG di Downloads, return path disk absolut. */
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

// ============ Path A — clipboard via CDP ============
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

    const before = await sendToContent('FLOW_COUNT_IMAGES');
    const focus = await sendToContent('FLOW_FOCUS_PROMPT');
    if (!focus.ok) return { ok: false, error: 'prompt box tidak ditemukan' };
    await sleep(300);

    const paste = await cdpPaste();
    if (!paste.ok) return { ok: false, error: paste.error };
    await sleep(2000);

    const after = await sendToContent('FLOW_COUNT_IMAGES');
    const verified = before.ok && after.ok && after.blobImgs > before.blobImgs;
    return { ok: true, verified };
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

// ============ Path B — drop sim ============
async function tryDropSimulation(b64, mime, filename) {
  const r = await sendToContent('FLOW_DROP_IMAGE', { b64, mime, filename });
  if (!r.ok) return { ok: false, error: r.error };
  await sleep(1500);
  return { ok: true };
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
