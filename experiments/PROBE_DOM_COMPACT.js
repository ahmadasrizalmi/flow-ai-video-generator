/** COMPACT probe — alternatif PROBE_DOM.js yang lebih pendek.
 * Cara: DevTools console → ketik  allow pasting  (Enter) → tempel ini → Enter.
 * Menghasilkan JSON satu blok. Salin hasil OUT ke bagian TEMUAN di
 * PROBE_JALUR_IMAGE.md
 */
(() => {
  const q = (s, r = document) => Array.from(r.querySelectorAll(s));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const c = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
  const OUT = { url: location.href, fileInputs: [], uploadBtns: [], icons: [], react: [] };

  // 1) input file
  q('input[type="file"]').forEach((el) => OUT.fileInputs.push({
    accept: (el.getAttribute('accept') || ''), multiple: el.multiple,
    hidden: getComputedStyle(el).display === 'none' || el.getBoundingClientRect().width === 0,
    pos: c(el)
  }));

  // 2) tombol ber-label upload/image/attach
  const KW = ['add','upload','attach','image','foto','photo','gambar','referen','reference','tambah','lampir','paperclip','first frame','start image','ingredient'];
  q('[aria-label],button').forEach((el) => {
    const t = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).toLowerCase();
    const hit = KW.filter((k) => t.includes(k));
    if (hit.length && vis(el)) OUT.uploadBtns.push({ t:(el.getAttribute('aria-label')||el.innerText||'').slice(0,40).trim(), hit:hit.slice(0,3), pos:c(el) });
  });

  // 3) tombol ber-icon svg yang mirip add-photo/upload
  q('button svg').forEach((svg) => {
    const b = svg.closest('button'); if (!b || !vis(b)) return;
    const d = (svg.innerHTML||'').toLowerCase();
    if (/image|photo|upload|attach|camera/.test(d)) OUT.icons.push({ aria:(b.getAttribute('aria-label')||'').slice(0,40), pos:c(b) });
  });

  // 4) react handlers onDrop/onPaste/onChange file
  q('body *').forEach((el) => {
    const k = Object.keys(el).find((fk) => fk.startsWith('__reactProps$')); if (!k) return;
    const p = el[k], r = el.getBoundingClientRect();
    if ((p.onDrop||p.onPaste||p.onChange) && r.width>0 && el.children.length<20)
      OUT.react.push({ tag:el.tagName, drop:!!p.onDrop, paste:!!p.onPaste, change:!!p.onChange, accept:(p.accept||'').slice(0,30) });
  });
  if (OUT.react.length > 40) OUT.react.length = 40;

  // Output: cetak sebagai STRING (bukan objek), + juga copy ke clipboard
  const jsonStr = JSON.stringify(OUT, null, 2);
  console.log('%c===== COPY_JSON =====', 'font-weight:bold;font-size:14px');
  console.log(jsonStr);
  console.log('%c===== END JSON =====', 'font-weight:bold;font-size:14px');
  try { copy(jsonStr); } catch (e) {}
  console.log(OUT.fileInputs.some(f=>/image/.test(f.accept)) ? 'ADA input file image' : 'TIDAK ADA input file image');
  console.log('Jumlah tombol upload (teks/icon):', OUT.uploadBtns.length + OUT.icons.length);
  console.log('React drop/paste/change hook:', OUT.react.length);
  return OUT;
})();
