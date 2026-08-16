/**
 * PROBE_DOM.js — Diagnostik halaman Google Flow untuk riset image reference.
 * -------------------------------------------------------------------------
 * Cara pakai:
 *   1. Buka labs.google/fx/.../tools/flow (masuk project).
 *   2. Buka DevTools (F12) → tab Console.
 *   3. Tempel seluruh isi file ini, tekan Enter.
 *   4. Salin hasil, tempel ke bagian TEMUAN di PROBE_JALUR_IMAGE.md
 *
 * Tujuan: memeriksa apakah Flow menyediakan input file / upload image
 * (image reference / first-frame) yang bisa kita kendalikan.
 * Script hanya MEMBACA DOM — aman, tidak mengubah apa pun.
 */
(() => {
  const out = {
    url: location.href,
    ts: new Date().toISOString(),
    fileInputs: [],
    buttonsMaybeUpload: [],
    dropZones: [],
    pasteListeners: false,
    rendering: detectRender(),
    promptLike: []
  };

  function qsa(s, root = document) { return Array.from(root.querySelectorAll(s)); }

  // ---- 1) Semua <input type=file> yang ada ----
  qsa('input[type="file"]').forEach((inp) => {
    const r = inp.getBoundingClientRect();
    out.fileInputs.push({
      accept: inp.getAttribute('accept') || '',
      multiple: inp.multiple,
      capture: inp.getAttribute('capture') || '',
      id: inp.id || '',
      cls: (inp.className || '').toString().slice(0, 60),
      hidden: inp.type === 'file' && (getComputedStyle(inp).display === 'none' || r.width === 0),
      visible: r.width > 0 && r.height > 0,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2)
    });
  });

  // ---- 2) Tombol/kontrol yang diduga upload image ----
  // Cari elemen/element button dengan teks/aria-label terkait upload.
  const KEYWORDS = ['tambah', 'add', 'upload', 'lampir', 'attach', 'referen',
    'reference', 'image', 'gambar', 'foto', 'photo', 'paperclip', 'first frame',
    'start image', 'start frame', 'ingredient'];
  const seen = new Set();
  ['button', '[role="button"]', '[aria-label]'].forEach((sel) => {
    qsa(sel).forEach((el) => {
      const label = (el.getAttribute && el.getAttribute('aria-label')) || '';
      const text = (el.innerText || '').toString().trim();
      const hay = (label + ' ' + text).toLowerCase();
      const hit = KEYWORDS.filter((k) => hay.includes(k));
      if (!hit.length) return;
      // skip kalau jelas bukan upload (mis tombol "tambah teks")
      const key = label + text;
      if (seen.has(key) || key.trim().length === 0) return;
      seen.add(key);
      const r = el.getBoundingClientRect();
      out.buttonsMaybeUpload.push({
        el: el.tagName,
        aria: label.slice(0, 60),
        text: text.slice(0, 40).replace(/\s+/g, ' '),
        match: hit.slice(0, 4),
        visible: r.width > 0 && r.height > 0,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2)
      });
    });
  });

  // ---- 2b) Tombol dengan ICON SVG (labels kosong) mirip add-image/photo ----
  // Pola path umum: add_photo, add_a_photo, image_outline, attach_file,
  // photo_camera, cloud_upload, add_circle. Banyak tombol Flow pakai icon.
  const iconKeywords = ['image', 'photo', 'upload', 'attach', 'camera',
    'paperclip', 'add_photo', 'image_outline'];
  const iconHits = [];
  qsa('button').forEach((b) => {
    const svg = b.querySelector('svg');
    if (!svg) return;
    const d = String(svg.innerHTML || '').toLowerCase();
    const draw = d.match(/d="([^"]+)/g) || [];
    const pathText = draw.join(' ').toLowerCase();
    const hit = iconKeywords.filter((k) => pathText.includes(k) || d.includes(k.replace(/_/g, ' ')));
    // juga cek <path d> gabungan label material
    if (!hit.length) return;
    const r = b.getBoundingClientRect();
    const key = 'svg:' + b.getAttribute('aria-label') + pathText.slice(0, 40);
    if (seen.has(key)) return;
    seen.add(key);
    iconHits.push({
      aria: (b.getAttribute('aria-label') || '').slice(0, 60),
      iconMatching: hit.slice(0, 4),
      visible: r.width > 0 && r.height > 0,
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2)
    });
  });
  if (iconHits.length) out.iconButtons = iconHits;

  // ---- 2c) React props onDrop/onPaste/onChange file di prompt area ----
  // Enumerasi properti React yang ditaruh di elemen DOM.
  const reactUpload = [];
  document.querySelectorAll('body *').forEach((el) => {
    const k = Object.keys(el).find((fk) => fk.startsWith('__reactProps$'));
    if (!k) return;
    const p = el[k] || {};
    if (p.onDrop || p.onPaste || p.onChange) {
      // hanya laporkan yang relevan (ada children & terlihat dekat prompt)
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && el.children.length < 20) {
        reactUpload.push({
          tag: el.tagName,
          hasOnDrop: !!p.onDrop,
          hasOnPaste: !!p.onPaste,
          hasOnChange: !!p.onChange,
          accept: (p.accept || '').slice(0, 40),
          cls: (el.className || '').toString().slice(0, 40),
          x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)
        });
      }
    }
  });
  // batasi agar tidak kebanyakan output
  if (reactUpload.length > 40) reactUpload.length = 40;
  out.reactUploadHooks = reactUpload;

  // ---- 3) Kedekatan drop-zone (elemen besar dengan style dashed/border) ----
  qsa('[data-accept], [accept], input[type=file]').forEach((el) => {
    const accept = el.getAttribute('accept') || '';
    if (accept.includes('image')) out.dropZones.push({ selector: 'input[accept*=image]', accept });
  });

  // ---- 4) Cek apakah ada event listener paste/drop di body (React app) ----
  // Kita tidak bisa enumerasi listener React langsung dari luar, tapi bisa
  // deteksi keberadaan atribut data react pada body/root.
  const reactPasteAttr = document.body.getAttribute('data-*') !== null;
  out.pasteListeners = !!(document.__reactProps || window.__REACT_DEVTOOLS_GLOBAL_HOOK__);

  // ---- 5) Tempat prompt (analog FLOW_CONFIG lama) ----
  qsa('div[contenteditable="true"][role="textbox"]').forEach((b) => {
    const r = b.getBoundingClientRect();
    out.promptLike.push({
      tag: b.tagName, cls: (b.className || '').toString().slice(0, 60),
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)
    });
  });

  // ---- 6) Deteksi media input di prompt area: paste handler / toolbar ----
  function detectRender() {
    // renderer webgl? (kemungkinan banyak canvas / WebGPU untuk video)
    return {
      canvas2d: qsa('canvas').length,
      webgl: (() => { let n = 0; qsa('canvas').forEach(c => { const gl = c.getContext && (c.getContext('webgl') || c.getContext('webgl2')); if (gl) n++; }); return n; })(),
      textboxes: qsa('div[contenteditable="true"]').length,
      tech: ''
    };
  }
  try {
    out.rendering.tech = (Function.prototype.toString.call(navigator.userAgent ? void 0 : undefined) === undefined) ? '' : '';
  } catch (e) {}

  console.log('%c=== FLOW IMAGE REFERENCE PROBE ===', 'font-weight:bold;font-size:14px');
  console.log('URL:', out.url);
  console.log('=> fileInputs:', out.fileInputs);
  console.log('=> buttonsMaybeUpload:', out.buttonsMaybeUpload);
  console.log('=> dropZones:', out.dropZones);
  console.log('=> promptLike:', out.promptLike);
  console.log('=> rendering:', out.rendering);
  console.log('%c--- Ringkasan cepat ---', 'font-weight:bold');
  const hasImgFile = out.fileInputs.some((f) => /image/.test(f.accept));
  const hasUploadBtn = out.buttonsMaybeUpload.length > 0 || (out.iconButtons || []).length > 0;
  const hasReactUpload = (out.reactUploadHooks || []).length > 0;
  console.log('Ada input file image?', hasImgFile);
  console.log('Ada tombol upload (teks/icon)?', hasUploadBtn, out.buttonsMaybeUpload.length ? '(teks)' : '', (out.iconButtons || []).length ? '(icon)' : '');
  console.log('Ada React drop/paste/change handler?', hasReactUpload, hasReactUpload ? '(' + out.reactUploadHooks.length + ' node)' : '');
  console.log('%c=== SALIN bagian `out` di bawah (JSON) ke PROBE_JALUR_IMAGE.md ===', 'font-weight:bold');
  console.log('COPY_JSON: ' + JSON.stringify(out, null, 2));

  // ---- TEST MANUAL: paste image ke prompt box ----
  console.log('%c=== UJI PASTE GAMBAR (manual, beberapa baris berikut) ===', 'font-weight:bold;font-size:12px');
  if (out.promptLike.length) {
    console.log(' 1. Fokus ke prompt box di halaman Flow.');
    console.log(' 2. Salin sebuah gambar (klik kanan gambar apa pun > Salin gambar).');
    console.log(' 3. Tekan Ctrl+V di dalam prompt box.');
    console.log(' 4. Amati: muncul thumbnail gambar di atas kolom prompt?');
    console.log(" 5. Jika YA, jalankan di console:\n" +
      "    copy('ANDA-DAPAT-PASTE-IMAGE');");
  } else {
    console.log('Tidak ada prompt box detected otomatis. Uji paste manual tetap bisa: fokus ke area input, Ctrl+V gambar.');
  }
  return out;
})();
