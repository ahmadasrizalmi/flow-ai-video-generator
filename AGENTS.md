# AGENTS.md — Konteks Permanen Proyek Flow AI Video Generator

> Dokumen ini dibaca otomatis oleh pi saat dijalankan di folder ini. Berisi **semua
> keputusan & status** hasil sesi musyawarah dengan user. Dipakai untuk melanjutkan
> pekerjaan walaupun sesi interaktif/terminal sudah dibersihkan.

---

## Identitas Proyek
- Nama: **Flow AI Video Generator**
- Repo baru (GitHub): `ahmadasrizalmi/flow-ai-video-generator` (private-access via token ahmadasrizalmi)
- **JANGAN** menyentuh repo lama `flow-batch-video-generator` (repo terpisah, tidak diubah).
- Tujuan: Chrome extension untuk membuat video batch di Google Flow, dibantu LLM (**DeepSeek**) menyusun prompt otomatis, + **image reference** agar karakter/produk konsisten (UGC / product promo / POV-mukbang).

---

## STATUS SAAT INI (Harus dibaca dulu sebelum lanjut)
- **FASE BUILD — STRUKTUR MULAI DIBANGUN (fase riset SELESAI).**
- **Probe 2026-08-16 KONFIRMASI Kasus A**: Flow punya `input[type=file][accept*=image]`
  hidden + prompt box punya React `onDrop`+`onPaste`. **User membuktikan paste gambar
  manual berhasil (thumbnail muncul)** → injeksi image TIDAK butuh path file OS;
  pakai clipboard+CDP trusted Ctrl+V (Path A) / drop sim (Path B) / file chooser (Path C).
- Struktur extension sudah dibuat (lihat `docs/ARCHITECTURE.md`):
  - `manifest.json` (MV3, module service worker)
  - `config/presets.js` (5 preset bawaan + SYAR'I_RULES + PROMPT_STRUCTURE)
  - `background/` bg.js (router) · cdp.js (CDP helper) · inject.js (Path A→B→C) · deepseek.js (API)
  - `content/content.js` (DOM reads, clipboard image, drop sim)
  - `panel/` (UI sesuai kesepakatan UX)
- **TODO berikutnya**: implementasi `runOneShot` (batch runner per shot) di
  `panel/panel.js` + uji end-to-end 1 shot dulu, lalu batch penuh.

---

## KRITIKAL BLOKER — SELESAI
- Probe berhasil dikirim &amp; dianalisis (2026-08-16): **Kasus A terkonfirmasi**.
- Bloker "user tak bisa kirim hasil probe" sudah teratasi via `PROBE_SATU_JALUR.js`
  (satu baris JSON + auto-copy).

---

## KEPUTUSAN USER (sudah disepakati, JANGAN diubah tanpa konfirmasi)
1. **Deskripsi subjek = manual** (di-ketik user). DeepSeek TIDAK bisa baca gambar →
   konsistensi karakter/produk dijamin dari deskripsi yang diketik, bukan dari vision.
2. **Image reference ke Flow = PRIORITAS UTAMA** (sekarang jalur riset; Pilihan 2 user =
   fokus riset mekanisme upload image ke Flow dulu sebelum membangun fitur lain).
3. **Preset tampil sebagai pilihan (dropdown) + bisa custom.** Preset default:
   UGC, Cinematic, **POV/mukbang**, Product Promo, Islami/Syar'i.
4. **Aspect ratio TIDAK ditulis ke prompt** — sudah ada di setelan Flow (horizontal/vertical).
5. **Satu API key DeepSeek**, disimpan di `chrome.storage.local` (diisi user di panel,
   pola dari `maps-scraper-extension`: field password, simpan ke storage, panggil
   `https://api.deepseek.com/chat/completions` OpenAI-compatible, `Authorization: Bearer`).
6. **UX simple** — sedikit checkbox/button. Kategori bawaan + tambah custom.
7. **Mode Syar'i (muslim)** toggle per preset → rule moral jadi **system-prompt** DeepSeek
   (hijab panjang menutup dada, lengan panjang, pakaian longgar; hindari aurat/pose sensual/
   kontak non-mahram, dsb).
8. **Preset POV**: subjek tak terlihat / hanya mulut + tangan, fokus produk + **suara ASMR**
   (mis. mukbang — suara makan nikmat).

---

## TEMUAN TEKNIS RISET (dari dokumentasi resmi Google)
- **Gemini Omni Flash** mendukung **image-to-video** & **karakter konsistensi** (ini model
  yang sama dengan target batch di Flow). Jadi pendekatan image-reference valid secara konsep.
- **Best practice image-to-video: "Prompt for motion only"** — jika image dipakai sebagai
  referensi/first-frame, prompt TIDAK perlu mendeskripsikan ulang subjek secara berlebihan.
  Fokus ke: **camera movement + subjek animation + environmental change + audio/dialog**.
  (BERBEDA dari text-to-video yang mengulang deskripsi karakter tiap shot.)
- **Struktur prompt video optimal** (dari prompt guide):
  Subject → Action → Scene → Camera angle → Camera movement → Lens/optical →
  Visual style/lighting → Temporal → Audio (SFX/dialog/ambient) → Negative prompt.
- **Audio didukung** (ASMR/SFX/dialog) — Veo 3.0 / Omni Flash.
- **1 prompt = 1 focused shot** untuk video pendek (bukan rantai A→B→C).
- **Format rujukan output**: file user `Video_Prompt_Final.txt` (per scene dengan timestamp,
  SHOT n, NARASI, VISUAL, Kamera, Speed, EFFECT, dst). Output DeepSeek harus meniru format ini
  agar siap di-batch.
- **Mechanisme injeksi gambar di Flow — TERBUKTI (probe 2026-08-16)**:
  - ✅ Ada `<input type=file accept=image/*>` hidden → jalur `DOM.setFileInputFiles` valid.
  - ✅ Prompt box punya React `onDrop`+`onPaste`; **paste gambar manual terbukti muncul thumbnail**
    → mekanisme utama = clipboard image + CDP trusted Ctrl+V (tanpa path file OS).
  - ⬜ Cadangan: drop sim DataTransfer / klik "Add Media" + `Page.fileChooserOpened`.
  - Semua memakai izin `chrome.debugger` (CDP) yang sudah ada di extension lama.
- **Risiko**: Flow (labs.google/fx) = product lab, UI/DOM sering berubah; selector/koordinat
  harus di-resolve ulang tiap batch. Ini mitigasi biasa (pola lama sudah terbukti).
  Tidak perlu pivot — image reference sungguhan BISA di-inject.

---

## Keamanan Token
- Token GitHub ahmadasrizalmi disimpan di **git credential store** (`~/.git-credentials`,
  chmod 600) — BUKAN di file repo / bukan di commit.
- Repo remote URL bersih (tanpa token): `https://github.com/ahmadasrizalmi/flow-ai-video-generator.git`
- JANGAN pernah commit/masukkin token ke file project.

---

## Cara memanggil/melanjutkan sesi
- Mulai menjadi **sesi bernama `flow`**: `pi --name flow` di folder project ini.
- Lanjut sesi terakhir: `pi --continue`.
- Pilih sesi: `pi --resume` (menu) / `pi --session flow`.
- Karena file ini (AGENTS.md) terbaca otomatis, konteks tetap ada meski sesi interaktif hilang.
