# 🎬 Flow AI Video Generator

Chrome extension untuk **membuat video batch di Google Flow** dengan bantuan
LLM (DeepSeek) untuk **menyusun prompt otomatis**, plus **image reference**
agar karakter/produk konsisten (UGC, product promo, dll).

> ✅ **STATUS: RISET SELESAI — STRUKTUR MULAI DIBANGUN.**
> - Probe membuktikan **Kasus A**: Flow punya `input[type=file][accept*=image]`
>   (hidden) + prompt box mendukung **drop & paste gambar** (thumbnail muncul ✓).
> - Arsitektur & skeleton extension dibuat (lihat `docs/ARCHITECTURE.md`):
>   manifest, preset engine, CDP helper, injeksi image (Path A clipboard-paste),
>   DeepSeek client, panel UI.
> - **TODO berikutnya**: implementasi batch runner per-shot di `panel.js`
>   (`runOneShot`) + uji end-to-end 1 shot dulu.
>
> Ini adalah **repo baru** terpisah dari `flow-batch-video-generator` lama —
> tidak menyentuh repo lama di GitHub sama sekali.

---

## Visi Fitur

### 1. Generate prompt otomatis via DeepSeek (1 API key)
- User isi **API key DeepSeek** di panel (disimpan ke `chrome.storage.local`, tak di-commit) → `https://api.deepseek.com/chat/completions` (OpenAI-compatible), berdasar pola `maps-scraper-extension`.
- Pilih **preset** (UGC, Cinematic, **POV/mukbang**, Product Promo, Islami) **atau tambah kategori custom**.
- Tentang: **deskripsi subjek/konsistensi**. DeepSeek **tidak bisa baca gambar**.
  Maka konsistensi produk/karakter dijamin lewat **deskripsi yang diketik user**
  (keputusan: manual).
- Output: **daftar shot terstruktur** format `Video_Prompt_Final.txt` (per scene
  & per shot). Tiap shot = 1 prompt **"motion + camera + audio"** yang cocok
  untuk Omni Flash di Flow.

### 2. Image reference ke Flow — PRIORITAS UTAMA (sedang diriset)
- User upload gambar produk/karakter di panel.
- Extension menyuntikkan gambar tsb ke Flow sebagai first-frame / reference.
- Mekanisme injeksi: **CDP `DOM.setFileInputFiles` / `Page.fileChooserOpened`**
  (extension sudah punya izin `chrome.debugger`). Lihat
  `experiments/CDP_FILE_INJECTION.md`.
- **Belum terbukti** apakah UI Flow saat ini punya input upload/paste image —
  inilah yang sedang dicek. JANGAN bangun di atas asumsi.

### 3. Preset bawaan + custom
| Preset | Fokus |
|---|---|
| **UGC** | gaya user-generated, natural, close-up, konsistensi produk |
| **Cinematic** | sinematik, kamera bergerak, lighting, gaya film |
| **POV** | subjek tak terlihat, fokus produk + **suara ASMR** (mis. mukbang) |
| **Product Promo** | sorot produk, fitur, angle dramatis |
| **Islami / Syar'i** | rule pakaian sopan (hijab panjang, lengan panjang), hindari haram |

### 4. Mode Syar'i (toggle per preset)
- Rule moral dipakai sebagai **system-prompt** DeepSeek → konsisten antar shot.
- Contoh: karakter perempuan berhijab panjang menutup dada, lengan panjang,
  pakaian longgar; karakter laki-laki sopan; hindari aurat, pose sensual,
  kontak fisik bukan-mahram, dsb.

### 5. UX sederhana (sedikit centang/button)
- **1 alur**: pilih kategori → (ketik deskripsi subjek) → upload image
  (opsional di jalur image) → pilih bahasa, durasi total, sound → **Generate**
  → muncul daftar shot → **Mulai Batch**.
- Aspect ratio **TIDAK di tulis ke prompt** — sudah diatur setelan Flow.

---

## Struktur Repo

```
flow-ai-video-generator/
├── docs/
│   ├── ARCHITECTURE.md     # desain arsitektur & alur data
│   └── ref/                # salinan dokumentasi Google (riset)
├── experiments/            # riset image reference (KASUS A terkonfirmasi)
├── manifest.json           # MV3: debugger, downloads, sidePanel, clipboardWrite
├── config/
│   └── presets.js          # preset bawaan + SYAR'I_RULES + PROMPT_STRUCTURE
├── background/
│   ├── bg.js               # service worker (module) + message router
│   ├── cdp.js              # helper CDP trusted (attach/ketik/enter/paste)
│   ├── inject.js           # injeksi image reference (Path A→B→C)
│   └── deepseek.js         # client DeepSeek + parse shot JSON
├── content/
│   └── content.js          # baca DOM Flow, clipboard image, drop sim
├── panel/
│   ├── panel.html / panel.js / style.css
└── icons/
```

---

## Alur yang sudah dimusyawarahkan dgn user
- [x] DeepSeek tak bisa baca gambar → **deskripsi manual** untuk anchor.
- [x] Aspect ratio tidak ditulis di prompt (dari setelan Flow).
- [x] **Image reference ke Flow = prioritas utama** (riset dulu; Pilihan 2).
- [x] Preset tampil sebagai **pilihan dropdown** + custom.
- [x] Satu API key DeepSeek (pattern maps-scraper-extension).
- [x] Preset **POV/mukbang** + **mode Syar'i**.
