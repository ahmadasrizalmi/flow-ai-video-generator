/**
 * FLOW AI VIDEO GENERATOR - Preset Engine
 * ----------------------------------------------------------------
 * Sumber kebenaran untuk: preset dropdown, rules system-prompt,
 * rules Syar'i, dan struktur output prompt yang diminta ke DeepSeek.
 *
 * Dibaca oleh panel.html via <script> (dan bisa dipakai bg bila perlu).
 * Custom preset user disimpan di chrome.storage.local key `customPresets`.
 */

'use strict';

const PRESETS = [
  {
    id: 'ugc',
    label: 'UGC',
    focus: 'Gaya user-generated content: natural, jujur, seperti video pelanggan asli.',
    rules: [
      'Gaya UGC natural, bukan iklan profesional.',
      'Kamera handheld ringan, sedikit goyang alami (bukan steady-cam kaku).',
      'Latar ruangan sehari-hari (kamar, dapur, meja kerja) dengan pencahayaan alami.',
      'Gaya bahasa narasi santai dan meyakinkan, seolah teman merekomendasikan.',
      'Close-up produk dari berbagai sudut, tunjukkan tekstur/cara pakai.',
      'Konsisten dengan deskripsi subjek yang diberikan.'
    ],
    defaults: { shots: 8, duration: 10, style: 'handheld natural', audio: 'narasi santai + suara ambient ruangan' }
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    focus: 'Gaya sinematik film: kamera bergerak, lighting dramatis, komposisi kuat.',
    rules: [
      'Gaya sinematik kelas film: komposisi rule-of-thirds, depth of field.',
      'Lighting dramatis (golden hour, kontras tinggi, praktikal).',
      'Kamera bergerak halus: dolly, crane, tracking, slow push-in.',
      'Warna teal-orange / tone konsisten antar shot.',
      'Konsisten dengan deskripsi subjek yang diberikan.'
    ],
    defaults: { shots: 10, duration: 8, style: 'cinematic film look', audio: 'ambient musik sinematik + SFX halus' }
  },
  {
    id: 'pov',
    label: 'POV / Mukbang',
    focus: 'Sudut pandang orang pertama: subjek tak terlihat / hanya mulut + tangan, fokus produk + suara ASMR.',
    rules: [
      'POV orang pertama: kamera = mata subjek, subjek TIDAK terlihat penuh.',
      'Yang terlihat: tangan memegang produk, mulut saat makan (untuk mukbang), produk di depan kamera.',
      'Fokus utama: produk dan reaksi suara (ASMR: suara makan nikmat, kemasan dibuka, tekstur).',
      'Close-up ekstrem pada detail produk: tekstur, potongan, guratan.',
      'Tidak ada wajah penuh subjek kecuali disepakati.',
      'Konsisten dengan deskripsi produk yang diberikan.'
    ],
    defaults: { shots: 8, duration: 10, style: 'first-person POV close-up', audio: 'ASMR jelas + mikrofon dekat (sensasi mukbang)' }
  },
  {
    id: 'product',
    label: 'Product Promo',
    focus: 'Sorot produk, fitur unggulan, angle dramatis yang menjual.',
    rules: [
      'Produk sebagai hero utama di setiap shot.',
      'Tampilkan fitur unggulan: tekstur, fungsi, cara pakai, hasil.',
      'Angle dramatis: low angle, macro, orbit, unboxing.',
      'Narasi singkat menjual: benefit > spesifikasi.',
      'Akhiri dengan ajakan (CTA) yang halus bila masuk scene.',
      'Konsisten dengan deskripsi produk yang diberikan.'
    ],
    defaults: { shots: 8, duration: 10, style: 'product-hero macro', audio: 'narasi menjual + SFX produk (klik, desis kemasan)' }
  },
  {
    id: 'syar-i',
    label: 'Islami / Syar\'i',
    focus: 'Konten sesuai kaidah syar\'i: busana sopan, adab, konten halal.',
    rules: [
      'Gaya islami yang hangat dan syar\'i.',
      'Semua karakter berpakaian sopan menutup aurat.',
      'Konten halal dan bermanfaat, tidak ada musik yang haram (boleh nasyid/ambient).',
      'Hindari konten yang sensual, ikhtilat, atau riya.',
      'Konsisten dengan deskripsi subjek yang diberikan.'
    ],
    defaults: { shots: 8, duration: 10, style: 'warm islamic', audio: 'nasyid halus / ambient + narasi tenang' }
  }
];

/** Aturan Syar'i GLOBAL — disuntik ke system prompt bila toggle Syar'i ON. */
const SYARI_RULES = [
  'WANITA: hijab panjang menutup dada, lengan panjang, pakaian longgar tidak transparan; wajah dan tangan boleh terlihat.',
  'PRIA: pakaian menutup dari pusar sampai lutut minimal, sopan dan rapi.',
  'Hindari pose sensual, gerakan menggoda, tatapan genit.',
  'Hindari kontak fisik lawan jenis yang bukan mahram.',
  'Hindari musik haram; gunakan ambient/nasyid halal atau suara alam.',
  'Konten fokus pada produk/manfaat, bukan pada fisik karakter.',
  'Tidak menampilkan makanan/minuman yang haram.'
];

/** Struktur output yang diminta dari DeepSeek (format Video_Prompt_Final.txt). */
const PROMPT_STRUCTURE = `
Output HARUS berupa JSON array (tanpa teks lain), setiap elemen:
{
  "n": 1,
  "ts": "0:00-0:10",
  "narasi": "naskah voice-over / dialog untuk scene ini (bahasa Indonesia)",
  "visual": "deskripsi visual: aksi subjek, aksi produk, lingkungan",
  "kamera": "angle + movement (mis. close-up, slow push-in)",
  "speed": "kecepatan (normal / slow motion / timelapse)",
  "effect": "efek / transisi / lens (mis. macro, shallow DOF)",
  "prompt_flow": "SATU prompt final untuk Google Flow: fokus MOTION + KAMERA + AUDIO saja (jangan deskripsikan ulang subjek secara berlebihan — image reference sudah ada)"
}
`;

/**
 * Bangun system prompt untuk DeepSeek.
 * @param {object} opts { presetId, syari:boolean }
 */
function buildSystemPrompt(opts) {
  const p = PRESETS.find((x) => x.id === opts.presetId);
  const lines = [
    'Kamu adalah penulis prompt video pendek profesional untuk Google Flow (model Gemini Omni Flash / Veo).',
    'Kamu memakai image reference: deskripsikan subjek HANYA bila perlu, fokus pada motion, kamera, dan audio.',
    'Gunakan format output berikut:',
    PROMPT_STRUCTURE
  ];
  if (p) {
    lines.push(`PRESET: ${p.label} — ${p.focus}`);
    lines.push('Rules preset:');
    p.rules.forEach((r) => lines.push(`- ${r}`));
  }
  if (opts.syari) {
    lines.push('MODE SYAR\'I (WAJIB dipatuhi):');
    SYARI_RULES.forEach((r) => lines.push(`- ${r}`));
  }
  lines.push('Beri setiap scene narasi bahasa Indonesia yang natural.');
  return lines.join('\n');
}

/**
 * Bangun user prompt untuk DeepSeek.
 * @param {object} opts { subjectDesc, shots, duration, extra }
 */
function buildUserPrompt(opts) {
  const lines = [
    `Deskripsi subjek/produk (WAJIB dijaga konsisten di semua shot):`,
    opts.subjectDesc || '(tidak diberikan)',
    '',
    `Jumlah shot: ${opts.shots || 8}`,
    `Durasi tiap video: ${opts.duration || 10} detik`,
    'Buat prompt_flow tiap shot sebagai SATU kalimat padat ala "prompt for motion only".'
  ];
  if (opts.extra) lines.push(opts.extra);
  return lines.join('\n');
}

if (typeof window !== 'undefined') {
  window.PRESETS = PRESETS;
  window.SYARI_RULES = SYARI_RULES;
  window.PROMPT_STRUCTURE = PROMPT_STRUCTURE;
  window.buildSystemPrompt = buildSystemPrompt;
  window.buildUserPrompt = buildUserPrompt;
}
