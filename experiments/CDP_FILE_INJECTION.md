# Riset CDP: Menyuntik Gambar ke Input File Flow

> Teknik inti untuk mekanisme "image reference ke Flow" — **jika** Flow
> menyediakan `<input type="file" accept="image/*">` atau mendukung
> **paste gambar** ke prompt. Extension lama sudah punya izin
> `chrome.debugger` (CDP) — jadi kita tinggal pakai.

---

## Dua jalur injeksi gambar (setelah probe mengonfirmasi)

### Jalur I — `DOM.setFileInputFiles` (paling andal utk input file)
Ideal saat probe menemukan `<input type="file" accept="image/*">` di DOM Flow.

Cara kerja CDP (via `chrome.debugger.sendCommand` yang sudah dipakai):
1. Temukan node id dari input file (bisa via `DOM.getDocument` +
   `DOM.querySelector` atau `DOM.getSearchResults`).
2. Ubah `files` pada node input:
   ```js
   // path file lokal user yang sudah dipilih di panel extension
   await cdp('DOM.setFileInputFiles', {
     files: ['C:/path/ke/gambar_user.png'],
     nodeId: <fileInputNodeId>
   });
   ```
   Ini mengisi input file seolah user memilih file — tangan Flow otomatis.
3. Flow membaca file tsb sebagai first-frame / reference image.
4. Setelahnya jalankan batch seperti biasa.

**Catatan penting:**
- Perlu `nodeId` — didapat lewat `DOM.getDocument`→`DOM.querySelector`.
- File harus berupa **path lokal tersedia di filesystem** browser user.
  Jadi di panel, saat user upload image, extension harus menyimpannya ke
  file (bisa lewat `chrome.downloads` sementara, atau ods) agar path
  tersedia. Atau gunakan teknik blob base64 → perlu buffer/save temp.
- Alternatif: `Page.setInterceptFileChooserDialog({enabled:true})` +
  listen `Page.fileChooserOpened` → `Page.handleFileChooser` (memberi
  base64 tanpa perlu path file). Ini lebih fleksibel karena tak perlu file
  fisik, tapi alurnya menunggu event "file chooser opened" (bisanya saat
  user mengklik tombol upload — perlu klik CDP dulu).

### Jalur II — Paste gambar (jika Flow menerima paste image)
Kalau probe menunjuk "typing area mendukung paste gambar":
- Extension bisa otomatis set clipboard image lalu `Input.dispatchKeyEvent`
  Ctrl+V di prompt box. Tapi kontrol clipboard image di CDP terbatas;
  lebih andal pakai teknik `copy()` + paste, atau set lewat
  `navigator.clipboard.write` dari content script (jika izin clipboard).

---

## Kode referensi: intersep file chooser via CDP

```js
// Di background.js (service worker), gunakan chrome.debugger.sendCommand.
// 1) Aktifkan intersep dialog chooser
await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
// 2) Listen event (chrome.debugger.onEvent) 'Page.fileChooserOpened'
chrome.debugger.onEvent.addListener((src, method, params) => {
  if (src.tabId !== tabId) return;
  if (method === 'Page.fileChooserOpened' && params.frameId === mainFrame) {
    // kirim file sebagai base64/bytes tanpa file fisik
    const backendNodeId = params.backendNodeId;
    // ... kirim data image (dari panel) via chrome.debugger.sendCommand
    // 'Page.handleFileChooser' langkahnya: tidak, untuk set konten,
    // pakai DOM.setFileInputFiles dengan path, ATAU
    // DOM.setFileInputFiles(files=[...], backendNodeId) — pilih backendNodeId param
  }
});
```

---

## Keputusan yang masih menunggu hasil probe

| Temuan probe | Mekanisme yang dipakai |
|---|---|
| Ada `input[type=file][accept*=image]` | Jalur I (`DOM.setFileInputFiles`), paling andal |
| Ada tombol upload, file chooser di-blok | Jalur I + `Page.handleFileChooser` |
| Hanya paste gambar didukung | Jalur II (clipboard) |
| Tidak ada sama sekali | Kasus B → pivot (B1/B2) di doc PROBE_JALUR_IMAGE.md |

---

## Referensi resmi CDP
- `Page.setInterceptFileChooserDialog`
- `Page.fileChooserOpened`
- `DOM.setFileInputFiles`
- Dokumen Gemini image-to-video API (lihat `ddoc/img2video`)  — model
  `gemini-omni-flash-preview`, task `image_to_video`, param `aspect_ratio` &
  `duration`; inilah konfirmasi bahwa referensi gambar adalah konsep resmi,
  tinggal memastikan Flow UI memaparkan upload-nya.

_TODO: setelah user menjalankan probe, isi bagian TEMUAN & isi mekanisme di atas dgn bukti._
