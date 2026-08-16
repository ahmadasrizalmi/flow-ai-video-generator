/**
 * FLOW AI VIDEO GENERATOR - CDP Helper (chrome.debugger)
 * ----------------------------------------------------------------
 * Pola terbukti dari flow-batch-video-generator: semua aksi yang butuh
 * event TRUSTED (ketik, enter, klik) harus lewat CDP karena React Flow
 * menolak event sintetik. Modul ini di-import oleh bg.js.
 */

'use strict';

export const CDP_TARGET = { tabId: null };

export function attachDebugger(tabId) {
  return new Promise((resolve) => {
    if (CDP_TARGET.tabId === tabId) return resolve({ ok: true, already: true });
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      CDP_TARGET.tabId = tabId;
      resolve({ ok: true });
    });
  });
}

export function detachDebugger() {
  return new Promise((resolve) => {
    const tabId = CDP_TARGET.tabId;
    if (tabId == null) return resolve({ ok: true });
    chrome.debugger.detach({ tabId }, () => {
      CDP_TARGET.tabId = null;
      resolve({ ok: true });
    });
  });
}

export function cdp(method, params = {}) {
  return new Promise((resolve) => {
    const tabId = CDP_TARGET.tabId;
    if (tabId == null) return resolve({ ok: false, error: 'debugger not attached' });
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true, result: res });
    });
  });
}

/** Ketik teks trusted ke elemen yang sedang fokus (insertText). */
export async function cdpInsertText(text) {
  return cdp('Input.insertText', { text });
}

/** Tekan Enter trusted. */
export async function cdpPressEnter() {
  await cdp('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
  return { ok: true };
}

/** Tekan Ctrl+V trusted (dipakai Path A injeksi image via clipboard). */
export async function cdpPaste() {
  await cdp('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'v', code: 'KeyV', modifiers: 2,
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'v', code: 'KeyV', modifiers: 2,
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86
  });
  return { ok: true };
}

/** Klik trusted di koordinat (x,y) viewport. */
export async function cdpClick(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return { ok: true };
}

/** Resolve nodeId dari selector via DOM CDP. */
export async function cdpQuerySelector(selector) {
  const doc = await cdp('DOM.getDocument', { depth: -1, pierce: true });
  if (!doc.ok) return { ok: false, error: doc.error };
  const q = await cdp('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!q.ok) return { ok: false, error: q.error };
  if (!q.result.nodeId) return { ok: false, error: 'selector tidak ditemukan: ' + selector };
  return { ok: true, nodeId: q.result.nodeId };
}
