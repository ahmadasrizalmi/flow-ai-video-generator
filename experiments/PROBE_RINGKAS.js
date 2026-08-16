/**
 * PROBE_RINGKAS.js — versi paling simpel, hasil pendek & gampang disalin.
 * -------------------------------------------------------------------
 * Cara pakai:
 *  1) Buka Flow → buka project video.
 *  2) F12 → Console → ketik:  allow pasting  (Enter)
 *  3) Tempel file ini → Enter.
 *  4) Hanya akan muncul BEBERAPA BARIS PENDEK hasilnya.
 *     Salin 6 baris itu dan kirim ke pi / tempel di chat.
 *
 * Tidak memunculkan objek besar — tiap baris angka/bool pendek.
 */
(() => {
  const q = (s, r = document) => Array.from(r.querySelectorAll(s));
  const line = (k, v) => console.log(k + ':', v);

  // ---- deteksi input file ----
  const fileInputs = q('input[type="file"]');
  let adaFileImage = false, acceptList = [], visiblePos = '';
  fileInputs.forEach((el) => {
    const ac = el.getAttribute('accept') || '';
    acceptList.push(ac);
    if (/image/.test(ac)) adaFileImage = true;
    const r = el.getBoundingClientRect();
    if (r.width > 0) visiblePos = Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2);
  });

  // ---- tombol ber-label/teks upload/image ----
  const KW = ['add','upload','attach','image','foto','photo','gambar','referen','reference','tambah','lampir','paperclip','first frame','start image','ingredient'];
  const labels = [];
  q('[aria-label]').forEach((el) => {
    const t = (el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '');
    const low = t.toLowerCase();
    const hit = KW.filter((k) => low.includes(k));
    if (hit.length) labels.push((el.getAttribute('aria-label') || '').slice(0, 40) + '[' + hit[0] + ']');
  });
  // batasi
  const labelShort = labels.filter((l, i) => i < 6);
  const adaTombolLabel = labels.length > 0;

  // ---- tombol ber-icon svg ----
  let iconCount = 0, iconFirst = '';
  q('button svg').forEach((svg) => {
    const d = (svg.innerHTML || '').toLowerCase();
    if (/image|photo|upload|attach|camera/.test(d)) {
      iconFirst = iconFirst || (svg.closest('button').getAttribute('aria-label') || '(icon tanpa label)');
      iconCount++;
    }
  });

  // ---- react onDrop/onPaste ----
  let reactDrop = false, reactPaste = false;
  q('body *').forEach((el) => {
    if (el.children.length > 20) return;
    const k = Object.keys(el).find((fk) => fk.startsWith('__reactProps$'));
    if (!k) return;
    if (el[k].onDrop) reactDrop = true;
    if (el[k].onPaste) reactPaste = true;
    const p = el[k];
    if (p.accept && /image/.test(p.accept || '')) reactDrop = true;
  });

  console.log('===== HASIL PROBE FLOW IMAGE =====');
  line('1. ada_input_file_image', adaFileImage);
  line('2. daftar_accept_file_input', JSON.stringify([...new Set(acceptList)]));
  line('3. ada_tombol_upload_label', adaTombolLabel ? JSON.stringify(labelShort) : 'false');
  line('4. ada_tombol_upload_icon', iconCount > 0 ? iconCount + ' -> ' + iconFirst : 'false');
  line('5. react_onDrop', reactDrop);
  line('6. react_onPaste', reactPaste);
  line('7. file_input_terlihat_di_pos', visiblePos || 'none');
  line('8. url', location.href);
  console.log('===== SALIN BARIS 1-7 di atas =====');

  // Auto save ke file ringkas buat jaga-jaga
  try {
    const blob = new Blob([[
      'ada_input_file_image=' + adaFileImage,
      'accept=' + JSON.stringify([...new Set(acceptList)]),
      'tombol_label=' + (adaTombolLabel ? JSON.stringify(labelShort) : 'false'),
      'tombol_icon=' + (iconCount > 0 ? iconCount + ':' + iconFirst : 'false'),
      'onDrop=' + reactDrop,
      'onPaste=' + reactPaste,
      'file_input_pos=' + visiblePos,
      'url=' + location.href
    ].join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flow_probe_hasil.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    console.log('Mencoba download file hasil ke folder Downloads: flow_probe_hasil.txt');
  } catch (e) { console.log('(gagal auto-download, salin manual baris 1-7 saja)'); }
})();
