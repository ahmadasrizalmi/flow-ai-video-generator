# Riset: Apakah Google Flow (labs.google/fx) Mendukung Image Reference?

> Status: **EKSPLORASI** — belum dibangun.
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

## TEMUAN (isi setelah menjalankan probe)

```
[Jangan hapus — isi di sini hasil probe]:

Ada input file?   : 
accept nya        : 
Tombol upload?    : 
aria-label        : 
onDrop/onPaste?   : 
Rendering         : canvas/webgl/dom?
Catatan flow ver  : 

Kesimpulan riset  : Kasus A / Kasus B / campuran
```
