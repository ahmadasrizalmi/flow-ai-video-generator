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
- **FASE RISET &amp; EKSPLORASI — belum fase build.**
- Prioritas utama = **meneliti &amp; membuktikan mekanisme "image reference ke Flow" (Pilihan 2 user).**
- Repo baru sudah di-`git init`, commit awal dibuat, di-push ke GitHub.
- File sudah ada:
  - `README.md` (visi, status, struktur)
  - `docs/ref/*.txt` (salinan dokumentasi resmi Google: Omni Flash, image-to-video, prompt guide, best practices)
  - `experiments/PROBE_JALUR_IMAGE.md` (rencana riset + tempat isi temuan)
  - `experiments/PROBE_DOM.js` (probe detail)
  - `experiments/PROBE_DOM_COMPACT.js` (probe compact)
  - `experiments/PROBE_RINGKAS.js` (hasil 7 baris ringkas)
  - `experiments/PROBE_SATU_JALUR.js` (hasil SATU baris JSON string siap salin)
  - `experiments/CDP_FILE_INJECTION.md` (mekanisme injeksi gambar via CDP)

---

## KRITIKAL BLOKER (belum selesai)
- **User belum berhasil mengirim hasil probe.** Kendala teknis: saat user copy output objek
  `OUT_JSON` dari console Chrome lalu paste ke pi, output **terpotong/terpisah** karena objek di
  console Chrome bersifat *collapsible*. Bukan masalah Chrome/pi; masalah format output.
- **Solusi terakhir yang dibuat**: `PROBE_SATU_JALUR.js` menampilkan hasil sebagai
  **SATU baris JSON string** (`HASIL_AWAL:: ... ::HASIL_AKHIR`) + **auto-copy** ke clipboard,
  supaya saat user paste ke pi seluruhnya ikut utuh.
- User menyebut sudah mencoba paste di Chrome **berhasil**; yang gagal adalah *menyalin hasilnya* ke pi.
- **NEXT STEP**: user harus menjalankan `PROBE_SATU_JALUR.js` di Flow, kirim hasil
  `HASIL_AWAL:: ... ::HASIL_AKHIR`, lalu kita tentukan mekanisme injeksi gambar.

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
- **Mechanisme injeksi gambar di Flow (belum dibuktikan)**: kemungkinan via
  - CDP `DOM.setFileInputFiles` (paling andal) jika ada `<input type=file accept=image/*>`
  - CDP `Page.fileChooserOpened` + klik tombol upload
  - Clipboard + Ctrl+V jika Flow menerima paste image
  - Semua memakai izin `chrome.debugger` (CDP) yang sudah ada di extension lama.
- **Risiko**: Flow (labs.google/fx) = product lab, UI/DOM sering berubah, mungkin belum punya
  slot image-reference. Jika probe menunjukkan TIDAK ada upload/paste, maka image-reference
  sungguhan tidak bisa di-inject → pivot dibahas dgn user (B1 text-anchor / B2 panggil API
  Gemini Omni image-to-video langsung).

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
