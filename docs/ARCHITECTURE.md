# Arsitektur Flow AI Video Generator

> Status: **STRUKTUR DISETUJUI — mulai implementasi bertahap** (2026-08-16).
> Fondasi diambil dari pola terbukti `flow-batch-video-generator` (CDP trusted
> events via `chrome.debugger`), ditambah 3 komponen baru: **image reference
> injection**, **DeepSeek prompt engine**, dan **preset engine**.

---

## 1. Alur data (end-to-end)

```
┌────────────────────────────────────────────────────────────────┐
│ PANEL (side panel kanan)                                       │
│  • API key DeepSeek (password, chrome.storage.local)           │
│  • Pilih preset (dropdown) + toggle Syar'i + custom preset      │
│  • Ketik deskripsi subjek (manual — DeepSeek tak baca gambar)   │
│  • Upload image reference (opsional, tetap base64 di storage)   │
│  • Jumlah shot, durasi, bahasa, dsb                             │
└───────────────┬────────────────────────────────────────────────┘
                │ "Generate Prompt"
                ▼
┌────────────────────────────────────────────────────────────────┐
│ BACKGROUND (bg.js → deepseek.js)                               │
│  • System prompt = preset rules + mode Syar'i rules            │
│  • User prompt  = deskripsi subjek + jumlah shot + format      │
│  • POST https://api.deepseek.com/chat/completions              │
│    (Authorization: Bearer <key>)                               │
│  • Output: JSON [ {n, ts, narasi, visual, kamera, speed,       │
│                   effect, prompt_flow}, ... ]                  │
└───────────────┬────────────────────────────────────────────────┘
                │ shot list → user preview → "Mulai Batch"
                ▼
┌────────────────────────────────────────────────────────────────┐
│ BACKGROUND (bg.js → inject.js → cdp.js)                        │
│ 1. attach chrome.debugger ke tab Flow aktif                    │
│ 2. inject image reference (lihat §3)                           │
│ 3. per shot: Input.insertText (trusted) → Enter trusted        │
│ 4. tunggu agent idle → tile video baru → chrome.downloads      │
└────────────────────────────────────────────────────────────────┘
```

## 2. Struktur folder

```
flow-ai-video-generator/
├── manifest.json              # MV3: debugger, downloads, sidePanel, clipboardWrite
├── docs/
│   ├── ARCHITECTURE.md        # file ini
│   └── ref/                   # salinan dokumentasi Google (riset)
├── experiments/               # hasil riset image reference (KASUS A)
├── config/
│   └── presets.js             # PRESETS + SYAR'I_RULES + PROMPT_STRUCTURE
├── background/
│   ├── bg.js                  # entry service worker (module) + message router
│   ├── cdp.js                 # helper CDP: attach/detach/click/insertText/enter/paste
│   ├── inject.js              # injeksi image reference (Path A/B/C, §3)
│   └── deepseek.js            # client API DeepSeek + builder system/user prompt
├── content/
│   └── content.js             # baca DOM Flow, koordinat, clipboard image, drop sim
├── panel/
│   ├── panel.html             # UI sesuai kesepakatan UX
│   ├── panel.js               # orkestrator: Generate → preview → Batch
│   └── style.css
└── icons/                     # icon16/32/48/128 (salin dari extension lama)
```

Catatan MV3:
- Service worker pakai `"type": "module"` → `bg.js` bisa `import` modul lain.
- `config/presets.js` & `panel.js` dimuat via `<script>` biasa di panel (bukan module) supaya
  bisa juga dipakai oleh konteks lain bila perlu.

## 3. Injeksi image reference — TEMUAN PROBE (2026-08-16)

Probe membuktikan **Kasus A**: ada `<input type="file" accept="image/*">` (hidden) dan
prompt box punya React `onDrop`+`onPaste`. **User juga membuktikan paste manual jalan**
(thumbnail muncul). Karena paste terbukti, kita TIDAK butuh path file OS → base64 dari
panel cukup. Strategi injeksi (urutan fallback):

| Path | Mekanisme | Butuh path file? | Keandalan |
|---|---|---|---|
| **A (utama)** | Content script `navigator.clipboard.write(ClipboardItem image)` → CDP trusted Ctrl+V di prompt box | Tidak | Reproduksi persis uji manual yang terbukti ✓ |
| **B (cadangan)** | Drop sim: DataTransfer + `File` dari base64 → dispatch `drop` di prompt box (React onDrop aktif) | Tidak | Bagus, tapi event sintetik |
| **C (terakhir)** | Klik "Add Media" → `Page.fileChooserOpened` → `DOM.setFileInputFiles` | Ya | Butuh path; hanya jika image tersimpan lokal |

Implementasi `background/inject.js` mengekspos `injectImage({b64, mime, filename})` yang
mencoba A → B → C dan mengembalikan status thumbnail.

## 4. DeepSeek prompt engine (`background/deepseek.js`)

- Satu key, `Authorization: Bearer`, `https://api.deepseek.com/chat/completions`
  (OpenAI-compatible), pattern dari `maps-scraper-extension`.
- **System prompt** = preset rules + (bila Syar'i) SYAR'I_RULES dari `config/presets.js`.
- **User prompt** = instruksi struktur output (format `Video_Prompt_Final.txt`: per scene,
  `SHOT n`, `NARASI`, `VISUAL`, `Kamera`, `Speed`, `EFFECT`) + deskripsi subjek + jumlah
  shot + bahasa + catatan "prompt for motion only" (image reference sudah ada).
- Output diminta **JSON ketat** agar panel bisa render daftar shot + tombol batch.

## 5. Preset engine (`config/presets.js`)

- `PRESETS`: UGC, Cinematic, POV/Mukbang, Product Promo, Islami/Syar'i → tiap preset punya
  `id, label, focus (1 kalimat), rules[] (system-prompt), defaults (jumlah shot, gaya)`.
- `SYAR'I_RULES`: aturan moral global (dipakai bila toggle Syar'i ON).
- `PROMPT_STRUCTURE`: template instruksi ke DeepSeek (Subject→Action→Scene→Camera→Lens→
  Lighting→Temporal→Audio→Negative) + contoh format output.
- Custom preset disimpan di `chrome.storage.local` (`customPresets`).

## 6. Batch runner (`panel.js` + `bg.js`)

Alur per shot (diwarisi dari extension lama, diperbarui):
1. `attachDebugger(tabId)` tab Flow aktif (user harus buka Flow dulu).
2. Inject image (Path A/B/C) — sekali di awal batch (Flow punya 1 media slot per project).
3. `FLOW_SUBMIT_PREP` (fokus prompt box) → `Input.insertText` trusted → Enter trusted.
4. Poll: `Hentikan` hilang (agent idle) → tile video baru muncul → `chrome.downloads`.
5. Lanjut shot berikutnya; log kemajuan di panel.

## 7. Keamanan

- API key DeepSeek hanya di `chrome.storage.local` (bukan di kode/commit).
- Gambar reference: base64 di `chrome.storage.local` (izin `unlimitedStorage`).
- Tidak ada token GitHub di repo (lihat AGENTS.md).

## 8. TODO implementasi (urutan)

1. [x] Riset image reference — KASUS A konfirmasi
2. [x] Skeleton struktur (manifest + modul)
3. [x] `config/presets.js` lengkap (isi rules tiap preset)
4. [x] `background/cdp.js` + `bg.js` router (pola lama, diverifikasi)
5. [x] `content/content.js` (clipboard image + drop sim + koordinat + tile video)
6. [x] `background/inject.js` Path A→B→C
7. [x] `background/deepseek.js` (client + builder)
8. [x] `panel/*` UI + Generate + preview shot + **Mulai Batch (runOneShot lengkap)**
9. [x] **Uji e2e pertama** — 3 issue ditemukan & diperbaiki:
    - **Image tak terinject** → Path A diubah: clipboard write via CDP `Runtime.evaluate`
      (main world) + `Browser.grantPermissions` + fokus tab dulu, lalu Ctrl+V trusted;
      plus verifikasi blob-image bertambah (thumbnail).
    - **Rasio** → dropdown 16:9/9:16 + `applyVideoRatio` (Setelan agen Flow via CDP,
      pola extension lama) di-port ke content/panel.
    - **DeepSeek tak berkesinambungan** → prompt engine diperbarui: format
      `Video_Prompt_Final.txt` (NARASI utuh + SHOT n + kesinambungan wajib),
      field `narration` di panel (narasi dibagi per shot), tombol "Salin Script (.txt)",
      parser fallback utk output daftar bernomor.
10. [ ] **Uji e2e ulang di Flow** (1 shot dulu → lalu batch penuh) ← di sini
    - Load unpacked → isi API key → tempel narasi → Generate → Mulai Batch
    - Periksa: inject image (Path A CDP), rasio ter-set, prompt berkesinambungan, download.
