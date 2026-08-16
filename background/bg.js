/**
 * FLOW AI VIDEO GENERATOR - Background Service Worker (module entry)
 * ----------------------------------------------------------------
 * Router message antara panel ↔ content ↔ CDP. Fondasi diwarisi dari
 * flow-batch-video-generator (terbukti jalan), ditambah message baru:
 * image injection (INJ_*) dan DeepSeek (DS_*).
 *
 * Izin chrome.debugger memunculkan infobar "mulai debugging" satu kali
 * per sesi — klik OK/Setujui sekali.
 */

'use strict';

import { CDP_TARGET, attachDebugger, detachDebugger, cdp, cdpInsertText, cdpPressEnter, cdpClick } from './cdp.js';
import { injectImage } from './inject.js';
import { getApiKey, setApiKey, chatCompletion, parseShots } from './deepseek.js';

// ---------- side panel ----------
function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
enableSidePanel();
chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);

// ---------- debugger lifecycle ----------
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === CDP_TARGET.tabId) CDP_TARGET.tabId = null;
  console.log('[FlowAI] debugger detached');
});

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      // ---- debugger / CDP ----
      case 'BG_ATTACH':
        return sendResponse(await attachDebugger(msg.tabId));
      case 'BG_DETACH':
        return sendResponse(await detachDebugger());
      case 'BG_CDP':
        return sendResponse(await cdp(msg.method, msg.params || {}));
      case 'BG_TYPE_TEXT':
        return sendResponse(await cdpInsertText(msg.text));
      case 'BG_PRESS_ENTER':
        return sendResponse(await cdpPressEnter());
      case 'BG_CLICK':
        return sendResponse(await cdpClick(msg.x, msg.y));

      // ---- image reference ----
      case 'INJ_IMAGE':
        return sendResponse(await injectImage(msg.img || {}, { promptBoxCoords: msg.coords }));

      // ---- DeepSeek ----
      case 'DS_GET_KEY':
        return sendResponse({ ok: true, key: await getApiKey() });
      case 'DS_SET_KEY':
        return sendResponse(await setApiKey(msg.key));
      case 'DS_GENERATE': {
        // msg: { system, user, temperature, maxTokens }
        const r = await chatCompletion(msg);
        if (!r.ok) return sendResponse(r);
        const parsed = parseShots(r.text);
        return sendResponse({ ok: parsed.ok, shots: parsed.shots, raw: r.text, error: parsed.error });
      }

      // ---- custom presets (chrome.storage.local) ----
      case 'PR_GET_CUSTOM':
        {
          const { customPresets } = await chrome.storage.local.get('customPresets');
          return sendResponse({ ok: true, customPresets: customPresets || [] });
        }
      case 'PR_SAVE_CUSTOM': {
        const { customPresets } = await chrome.storage.local.get('customPresets');
        const list = customPresets || [];
        const i = list.findIndex((p) => p.id === msg.preset.id);
        if (i >= 0) list[i] = msg.preset; else list.push(msg.preset);
        await chrome.storage.local.set({ customPresets: list });
        return sendResponse({ ok: true });
      }
      case 'PR_DELETE_CUSTOM': {
        const { customPresets } = await chrome.storage.local.get('customPresets');
        await chrome.storage.local.set({ customPresets: (customPresets || []).filter((p) => p.id !== msg.id) });
        return sendResponse({ ok: true });
      }

      // ---- batch status (image slot tersimpan untuk dipakai batch) ----
      case 'BATCH_SET_IMAGE':
        {
          // simpan image reference yang akan dipakai batch (base64 bisa besar;
          // izin unlimitedStorage sudah ada)
          await chrome.storage.local.set({ batchImage: msg.img || null });
          return sendResponse({ ok: true });
        }
      case 'BATCH_GET_IMAGE':
        {
          const { batchImage } = await chrome.storage.local.get('batchImage');
          return sendResponse({ ok: true, img: batchImage || null });
        }

      default:
        return sendResponse({ ok: false, reason: 'unknown: ' + msg.type });
    }
  })();
  return true; // async
});

console.log('[FlowAI] background siap');
