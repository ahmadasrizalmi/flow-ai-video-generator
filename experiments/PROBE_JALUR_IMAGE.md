# Riset: Apakah Google Flow (labs.google/fx) Mendukung Image Reference?

> Status: **PROBE SELESAI — Kasus A KONFIRMASI** (input file image ada + prompt box mendukung drop/paste).
> Selanjutnya: buktikan injeksi via CDP `DOM.setFileInputFiles` (lihat CDP_FILE_INJECTION.md).
> Tujuan: mengetahui secara empiris apakah UI Flow saat ini menyediakan
> mekanisme upload gambar (image reference / first-frame) yang bisa
> dimanipulasi oleh extension, dan bagaimana caranya.

---

## Kenapa bagian ini berisiko & butuh riset dulu

- Kode extension lama (`flow-batch-video-generator`) **hanya** mengisi
  **prompt text box** via CDP dan mendownload video. **Tidak ada** kode
  upload image ke Flow.
- Flow (`labs.google/fx`) adalah **product lab yang DOM/UI-nya sering
  berubah** dan tidak didesain untuk API eksternal.
- Dokumentasi Gemini Omni Flash mendukung image-to-video, tapi itu di
  **Gemini Enterprise Agent Platform / Vertex** — **belum tentu** tersedia
  di UI konsumer Flow gratis.

Karena saya tidak bisa membuka browser sendiri, langkah pertama adalah
**membangun probe diagnostik** yang DiJALANKAN user di halaman Flow,
untuk membaca DOM asli dan memutuskan mekanisme berdasarkan data nyata —
bukan menebak.

---

## Langkah-langkah riset

1. Buka Flow (`labs.google/fx/.../tools/flow`) di browser.
2. Buka DevTools → Console.
3. Tempel & jalankan `@flow_probe` dari `PROBE_DOM.js` (lihat file tsb).
4. Baca hasil:
   - Ada `<input type="file">` dengan `accept="image/*"`? → kemungkinan besar
     bisa upload image.
   - Ada tombol ber-`aria-label` "Add image / Upload / Attach / Reference /
     paperclip"?
   - React props `onDrop`/`onPaste` di prompt area?
5. Tempel temuan ke bagian "Temuan" di bawah.

---

## Alur setelah tahu ada/tidak ada upload

### Kasus A — Ada mekanisme `input[type=file]` image di UI Flow
- Extension memakai pola **file chooser CDP** (`Page.setInterceptFileChooserDialog`
  atau `DOM.setFileInputFiles`) untuk "menempelkan" gambar dari panel
  langsung ke input file Flow — cara yang jauh lebih andal daripada
  simulasi klik/`DataTransfer` (yang ditolak React synthetic events).
- Alurnya: user upload image di panel → extension kirim `base64`/blob →
  lewat CDP set ke input file Flow yang cocok → generasi pakai first-frame.

### Kasus B — Tidak ada upload UI (Flow hanya text-to-video saat ini)
- Image reference **tidak bisa** di-inject langsung ke Flow versi sekarang.
- Opsi pivoting (dievaluasi dgn user):
  1. **Jalur B1 (text-anchor, dijamin jalan):** image → deskripsi manual
     (DeepSeek tak baca gambar) disisipkan konsisten ke tiap prompt.
  2. **Jalur B2 (proxy API Google):** kalau user punya project Google Cloud +
     image di Cloud Storage, extension bisa panggil Gemini Omni Flash
     **image-to-video API** langsung (bukan lewat UI Flow) untuk membuat
     video referensi — tapi ini di luar "batch di Flow".

---

## TEMUAN (hasil probe 2026-08-16, Flow project bcae3b9c...)

```
Ada input file?   : YA — 1x <input type="file" accept="image/*" multiple=false>
                   :   (hidden, cls "sc-dcc7b7da-0 fhJvUC", di belakang tombol Add Media)
accept nya        : image/* (hanya gambar, single file)
Tombol upload?    : YA — "Add Media" (x:766 y:38) = pemicu input tsb
                   :   "image View images" (x:40 y:153)
                   :   "drive_folder_upload View uploaded media" (x:40 y:311)
aria-label        : "add Add Media"
onDrop/onPaste?   : prompt box (kls sc-1c9f7009-0 ... iIcaa*, x:494 y:673) punya
                   :   React onDrop + onPaste (synthetic events) → paste/drop gambar
                   :   ke prompt box DIDUKUNG. (pasteListeners:false hanya cek native
                   :   addEventListener — false positive, React pakai delegation.)
Rendering         : DOM/text (bukan canvas/webgl) → semua elemen bisa di-CDP
Catatan flow ver  : labs.google/fx tools/flow, URL project bcae3b9c-c7e9-40da-b76f-e7c654bb29b4

Kesimpulan riset  : KASUS A — mekanisme upload image ada, bisa di-inject CDP.
```

### Buat apa ini
- **Jalur I (pilihan utama):** `DOM.setFileInputFiles` langsung ke
  `input[accept*=image]` — tidak perlu menampilkan input atau klik tombol;
  CDP bisa set file ke node hidden. Cukup `DOM.getDocument` +
  `DOM.querySelector('input[accept*=image]')` → dapat `nodeId` → set file.
- **Jalur II (cadangan):** simulasikan paste/drop gambar ke prompt box
  (React onDrop/onPaste) — perlu DataTransfer; lebih rapuh dari Jalur I.
- **Jalur III (fallback UI):** klik tombol "Add Media" → intersep
  `Page.fileChooserOpened` → set file via `backendNodeId`.

### Verifikasi manual opsional (bonus)
1. Fokus ke prompt box di Flow.
2. Salin gambar (klik kanan gambar > Salin gambar).
3. Ctrl+V di prompt box.
4. Kalau muncul thumbnail di atas kolom prompt → paste didukung (Jalur II).
   (Ini bukan prasyarat — Jalur I sudah terkonfirmasi dari input file.)

### Risiko / catatan
- Input file hidden → pastikan `nodeId` di-resolve ulang tiap batch
  (DOM Flow re-render, node id bisa berganti).
- `DOM.setFileInputFiles` butuh **path file lokal** browser user; panel harus
  simpan image upload user ke file temp (lihat CDP_FILE_INJECTION.md).
- Single file (`multiple=false`) → cukup 1 image reference per project.
