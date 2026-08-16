/**
 * FLOW AI VIDEO GENERATOR - DeepSeek Client
 * ----------------------------------------------------------------
 * Satu API key disimpan di chrome.storage.local (pattern
 * maps-scraper-extension: field password → storage → Bearer).
 * Endpoint: https://api.deepseek.com/chat/completions (OpenAI-compatible).
 *
 * System prompt dibangun dari config/presets.js (preset + syar'i).
 * Output diharapkan JSON array shot (lihat PROMPT_STRUCTURE).
 */

'use strict';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ambil API key dari chrome.storage.local. */
export async function getApiKey() {
  const { deepseekKey } = await chrome.storage.local.get('deepseekKey');
  return deepseekKey || '';
}

/** Simpan API key (dipanggil panel, field bertipe password). */
export async function setApiKey(key) {
  await chrome.storage.local.set({ deepseekKey: String(key || '').trim() });
  return { ok: true };
}

/**
 * Panggil DeepSeek chat completion.
 * @param {object} opts { system, user, temperature?, maxTokens? }
 * @returns {Promise<{ok:boolean, text?:string, error?:string}>}
 */
export async function chatCompletion(opts) {
  const key = await getApiKey();
  if (!key) return { ok: false, error: 'API key DeepSeek belum diisi' };

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user }
    ],
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 4000
  };

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: 'DeepSeek HTTP ' + resp.status + ': ' + t.slice(0, 200) };
    }
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return { ok: false, error: 'DeepSeek: response kosong' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Parse output DeepSeek (teks) menjadi array shot.
 * Tahan terhadap pembungkus ```json ... ``` atau teks sampah di tepi.
 */
export function parseShots(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: 'output bukan JSON array' };
  }
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return { ok: false, error: 'output bukan array' };
    return { ok: true, shots: arr };
  } catch (e) {
    return { ok: false, error: 'parse JSON gagal: ' + e.message };
  }
}
