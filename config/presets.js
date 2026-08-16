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
    focus: 'Sudut pandang orang pertama: subjek tampil parsial (bagian bawah wajah, tangan, hijab di frame bawah), fokus produk + suara ASMR.',
    rules: [
      'POV orang pertama dengan subjek PARSIAL: bagian bawah wajah (mulut, dagu, pipi), tangan, dan hijab boleh tampil di frame bawah.',
      'Subjek TIDAK tampil penuh: dahi ke dagu penuh tanpa hijab tidak ditampilkan; tatapan mata langsung ke lensa dihindari.',
      'Yang terlihat: tangan memegang produk, mulut saat makan (untuk mukbang), hijab/aksesori (mis. stiker pipi) di tepi bawah frame, produk di depan kamera.',
      'Fokus utama: produk dan reaksi suara (ASMR: suara makan nikmat, kemasan dibuka, tekstur).',
      'Close-up ekstrem pada detail produk: tekstur, potongan, guratan.',
      'Wajah penuh subjek hanya bila disepakati.',
      'Konsisten dengan deskripsi subjek yang diberikan (hijab, warna pakaian, aksesori disebut saat relevan).'
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
Output HARUS berupa JSON array (tanpa teks lain, tanpa markdown fence). Setiap elemen:
{
  "n": 1,
  "ts": "0:00-0:10",
  "narasi": "teks voice-over scene ini (bahasa Indonesia, HANYA segmen narasi yang tepat untuk shot ini)",
  "visual": "deskripsi visual berkesinambungan: aksi subjek, aksi produk, lingkungan (boleh berisi bullet dengan tanda •)",
  "kamera": "angle + movement (mis. close-up, slow push-in)",
  "speed": "normal / slow motion / timelapse / speed ramp",
  "effect": "efek / transisi / lens (mis. macro, shallow DOF, whip pan)",
  "fitur": "fitur produk yang ditonjolkan di shot ini (opsional)",
  "prompt_flow": "SATU kalimat prompt final untuk Google Flow: fokus MOTION + KAMERA + AUDIO saja; JANGAN deskripsikan ulang subjek secara berlebihan (image reference sudah ada)"
}

ATURAN KESINAMBUNGAN (WAJIB dipatuhi):
- Cerita mengalir seperti naskah video sungguhan: shot 1 membuka/establish, shot berikutnya MELANJUTKAN aksi, shot terakhir menutup dengan natural (CTA/ending).
- PRODUK/SUBJEK UTAMA WAJIB TETAP TERLIHAT DI SEMUA SHOT — boleh di tangan, di latar, atau di atas nampan; JANGAN menghilangkan produk utama di shot mana pun. Elemen pendukung (nasi, sambal, lalapan, gelas) boleh muncul, TAPI tidak boleh menggantikan peran visual produk utama.
- AKSI BERKELANJUTAN: kondisi produk di shot n berlanjut ke shot n+1 (mis. ayam utuh di shot 1 → digigit di shot 2 → setengah dimakan tetap di frame di shot 3).
- DESKRIPSI SUBJEK YANG DIBERIKAN USER ADALAH CANON: ciri karakter/produk (mis. hijab dusty pink, ayam jumbo bersambal merah pekat, talenan kayu, lalapan) disebut ulang di field "visual" tiap shot saat relevan — KONSISTEN dari shot pertama sampai terakhir.
- Karakter/produk/lingkungan/gaya pencahayaan KONSISTEN dari shot pertama sampai terakhir.
- Narasi tersambung: potong narasi di tempat yang masuk akal, shot n+1 melanjutkan kalimat/adegan shot n (jangan mengulang atau melompat acak).
- Transisi visual berkesinambungan: aksi yang berakhir di satu shot dilanjutkan di shot berikutnya (match cut / aksi berkelanjutan / angle berbeda pada momen yang sama).
- Tiap shot punya sudut pandang/aksi BARU yang MAJU (bukan variasi foto yang sama), tapi elemen utama tetap hadir di frame.
- Durasi tiap shot sesuai ts (default 10 detik).
- Kalau narasi lengkap diberikan, pertahankan teksnya apa adanya (potong di tempat wajar untuk tiap segmen).
- Kalau narasi TERLALU PENDEK utk jumlah shot (mis. 1 kalimat utk 8 shot): pakai teks asli sebagai PEMBUKA shot 1, lalu LANJUTKAN cerita secara natural (adegan mukbang berkembang: siapkan, gigitan pertama, reaksi pedas, minum, sambal tambahan, dll) tanpa mengulang kalimat pembuka.
`;

/**
 * Bangun system prompt untuk DeepSeek.
 * @param {object} opts { presetId, syari:boolean }
 */
function buildSystemPrompt(opts) {
  const p = PRESETS.find((x) => x.id === opts.presetId);
  const lines = [
    'Kamu adalah penulis naskah video pendek profesional untuk Google Flow (model Gemini Omni Flash / Veo),',
    'meniru gaya dokumen "Video_Prompt_Final.txt" (format: NARASI utuh ber-timestamp, lalu per shot: SHOT n + NARASI, VISUAL, Kamera, Speed, EFFECT, FITUR).',
    'Pola dari Video_Prompt_Final.txt: ELEMEN UTAMA SELALU DIULANG dengan sudut/aksi berbeda — mis. peta Indonesia muncul di shot 1, 4, 9, 13, 14; logo di shot 5, 17, 18; karakter utama di shot 2, 12, 16. Tiru pola ini: produk/subjek utama harus muncul di SEMUA shot.',
    'Kamu memakai image reference: untuk prompt_flow, fokus pada motion, kamera, dan audio (jangan deskripsikan ulang subjek). Untuk field "visual", deskripsi subjek tetap ditulis lengkap dan konsisten.',
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
  lines.push('Beri setiap scene narasi bahasa Indonesia yang natural dan berkesinambungan.');
  return lines.join('\n');
}

/**
 * Bangun user prompt untuk DeepSeek.
 * @param {object} opts { subjectDesc, narration?, shots, duration, extra }
 */
function buildUserPrompt(opts) {
  const lines = [
    `JUDUL: ${opts.title || 'Video promosi produk'}`,
    ''
  ];
  if (opts.narration && String(opts.narration).trim()) {
    lines.push('NARASI LENGKAP (bagi menjadi segmen berurutan — 1 segmen = 1 shot;');
    lines.push('pertahankan teks apa adanya di field "narasi" tiap shot):');
    lines.push(String(opts.narration).trim());
    lines.push('');
  } else {
    lines.push('Tidak ada narasi lengkap — tulis narasi sendiri yang mengalir dan berkesinambungan sesuai preset.');
    lines.push('');
  }
  lines.push('Deskripsi subjek/produk (WAJIB dijaga konsisten di semua shot):');
  lines.push(opts.subjectDesc || '(tidak diberikan)');
  lines.push('');
  lines.push(`Jumlah shot: ${opts.shots || 8}`);
  lines.push(`Durasi tiap video: ${opts.duration || 10} detik`);
  lines.push('Setiap shot harus MELANJUTKAN cerita shot sebelumnya (kesinambungan), bukan daftar acak.');
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
